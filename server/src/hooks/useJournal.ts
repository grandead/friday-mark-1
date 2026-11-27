import { useCallback, useEffect, useRef, useState } from 'react';
import { getJson } from '@/lib/get-json';
import { userError } from '../lib/errors';
import type { Interaction, InteractionPage } from '../lib/journal';

function compareInteractions(a: Interaction, b: Interaction) {
  return b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id);
}

type InteractionFeedState = {
  items: Interaction[];
  loading: boolean;
  hasMore: boolean;
  error: string;
  reconnecting: boolean;
};

export function useJournal(query: string) {
  const [state, setState] = useState<InteractionFeedState>({
    items: [],
    loading: true,
    hasMore: false,
    error: '',
    reconnecting: false,
  });
  const more = useRef<() => void>(() => {});
  const loadMore = useCallback(() => more.current(), []);

  useEffect(() => connectFeed(query, setState, more), [query]);
  return { ...state, loadMore };
}

type UpdateState = React.Dispatch<React.SetStateAction<InteractionFeedState>>;

function connectFeed(query: string, setState: UpdateState, more: { current: () => void }) {
  const feed = new JournalFeed(query, setState);
  more.current = () => feed.loadMore();
  feed.start();
  return () => feed.close();
}

class JournalFeed {
  private readonly controller = new AbortController();
  private readonly events = new EventSource('/api/interactions/live');
  private readonly filters: URLSearchParams;
  private readonly interactions = new Map<string, Interaction>();
  private cursor: InteractionPage['nextCursor'] = null;
  private initialized = false;
  private busy = false;
  private refreshPending = false;
  private retryRefresh = false;
  private changedDuringRequest = new Set<string>();

  constructor(
    query: string,
    private readonly setState: UpdateState,
  ) {
    this.filters = new URLSearchParams(query);
  }

  start() {
    this.events.onopen = () => this.onOpen();
    this.events.onerror = () => this.onError();
    this.events.addEventListener('interaction.updated', (event) => this.update(event));
    void this.load(true);
  }

  close() {
    this.controller.abort();
    this.events.close();
  }

  loadMore() {
    void this.load(this.retryRefresh || !this.initialized);
  }

  private onOpen() {
    this.setState((s) => ({ ...s, reconnecting: false }));
    void this.load(true);
  }

  private onError() {
    this.setState((s) => ({ ...s, reconnecting: true }));
  }

  private publish() {
    if (this.controller.signal.aborted) return;
    const items = [...this.interactions.values()].sort(compareInteractions);
    const hasMore = Boolean(this.cursor);
    this.setState((s) => ({ ...s, items, hasMore }));
  }

  private async load(refresh: boolean) {
    if (this.busy) {
      if (refresh) this.refreshPending = true;
      return;
    }
    if (!refresh && this.initialized && !this.cursor) return;
    this.busy = true;
    this.changedDuringRequest = new Set();
    this.setState((s) => ({ ...s, loading: true, error: '' }));
    const oldest = [...this.interactions.values()].sort(compareInteractions).at(-1);
    let next = refresh ? null : this.cursor;
    const fetched: Interaction[] = [];
    try {
      // On reconnect, reconcile the whole loaded range, including events missed while offline.
      do {
        const params = new URLSearchParams(this.filters);
        if (next) {
          params.set('before', next.startedAt);
          params.set('beforeId', next.id);
        }
        const page = await getJson<InteractionPage>(
          `/api/interactions?${params}`,
          this.controller.signal,
        );
        fetched.push(...page.items);
        next = page.nextCursor;
        const last = page.items.at(-1);
        if (!refresh || !oldest || !next || (last && compareInteractions(last, oldest) >= 0)) break;
      } while (!this.controller.signal.aborted);
      if (this.controller.signal.aborted) return;
      for (const item of fetched) {
        if (!this.changedDuringRequest.has(item.id)) this.interactions.set(item.id, item);
      }
      this.cursor = next;
      this.initialized = true;
      this.retryRefresh = false;
      this.publish();
    } catch (error) {
      this.retryRefresh = refresh;
      const message = userError(error);
      if (!this.controller.signal.aborted) this.setState((s) => ({ ...s, error: message }));
    } finally {
      this.busy = false;
      if (!this.controller.signal.aborted) {
        this.setState((s) => ({ ...s, loading: false }));
        if (this.refreshPending) {
          this.refreshPending = false;
          void this.load(true);
        }
      }
    }
  }

  private update(event: MessageEvent<string>) {
    const item: Interaction = JSON.parse(event.data);
    const deviceId = this.filters.get('deviceId');
    const userId = this.filters.get('userId');
    const from = this.filters.get('from');
    const to = this.filters.get('to');
    const timestamp = Date.parse(item.startedAt);
    const matches =
      (!deviceId || item.deviceId === deviceId) &&
      (!userId || item.userId === userId) &&
      (!from || timestamp >= Date.parse(from)) &&
      (!to || timestamp <= Date.parse(to));
    if (!matches) return;
    const oldest = [...this.interactions.values()].sort(compareInteractions).at(-1);
    if (
      this.cursor &&
      oldest &&
      compareInteractions(item, oldest) > 0 &&
      !this.interactions.has(item.id)
    )
      return;
    if (this.busy) this.changedDuringRequest.add(item.id);
    this.interactions.set(item.id, item);
    this.publish();
  }
}
