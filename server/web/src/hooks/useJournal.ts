import { useCallback, useEffect, useRef, useState } from 'react';
import { getJson, type Entry, type JournalPage } from '../lib/journal';

function compareEntries(a: Entry, b: Entry) {
  return b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id);
}

type FeedState = { items: Entry[]; loading: boolean; hasMore: boolean; error: string; reconnecting: boolean };

export function useJournal(query: string) {
  const [state, setState] = useState<FeedState>({ items: [], loading: true, hasMore: false, error: '', reconnecting: false });
  const more = useRef<() => void>(() => {});
  const loadMore = useCallback(() => more.current(), []);

  useEffect(() => {
    const controller = new AbortController();
    const filters = new URLSearchParams(query);
    const entries = new Map<string, Entry>();
    let cursor: JournalPage['nextCursor'] = null;
    let initialized = false;
    let busy = false;
    let refreshPending = false;
    let retryRefresh = false;
    let changedDuringRequest = new Set<string>();

    function publish() {
      if (!controller.signal.aborted) {
        setState(s => ({ ...s, items: [...entries.values()].sort(compareEntries), hasMore: Boolean(cursor) }));
      }
    }

    async function load(refresh: boolean) {
      if (busy) {
        if (refresh) refreshPending = true;
        return;
      }
      if (!refresh && initialized && !cursor) return;
      busy = true;
      changedDuringRequest = new Set();
      setState(s => ({ ...s, loading: true, error: '' }));
      const oldest = [...entries.values()].sort(compareEntries).at(-1);
      let next = refresh ? null : cursor;
      const fetched: Entry[] = [];
      try {
        // On reconnect, reconcile the whole loaded range, including events missed while offline.
        do {
          const params = new URLSearchParams(filters);
          if (next) {
            params.set('before', next.startedAt);
            params.set('beforeId', next.id);
          }
          const page = await getJson<JournalPage>(`/api/interactions?${params}`, controller.signal);
          fetched.push(...page.items);
          next = page.nextCursor;
          const last = page.items.at(-1);
          if (!refresh || !oldest || !next || (last && compareEntries(last, oldest) >= 0)) break;
        } while (!controller.signal.aborted);
        if (controller.signal.aborted) return;
        for (const item of fetched) {
          if (!changedDuringRequest.has(item.id)) entries.set(item.id, item);
        }
        cursor = next;
        initialized = true;
        retryRefresh = false;
        publish();
      } catch (error) {
        retryRefresh = refresh;
        if (!controller.signal.aborted) setState(s => ({ ...s, error: (error as Error).message }));
      } finally {
        busy = false;
        if (!controller.signal.aborted) {
          setState(s => ({ ...s, loading: false }));
          if (refreshPending) {
            refreshPending = false;
            void load(true);
          }
        }
      }
    }

    more.current = () => { void load(retryRefresh || !initialized); };
    const events = new EventSource('/api/journal/events');
    events.onopen = () => {
      setState(s => ({ ...s, reconnecting: false }));
      void load(true);
    };
    events.onerror = () => {
      setState(s => ({ ...s, reconnecting: true }));
    };
    events.addEventListener('replyAudioSaved', event => {
      const item: Entry = JSON.parse(event.data);
      const deviceId = filters.get('deviceId');
      const userId = filters.get('userId');
      const from = filters.get('from');
      const to = filters.get('to');
      const timestamp = Date.parse(item.startedAt);
      const matches = (!deviceId || item.deviceId === deviceId) && (!userId || item.userId === userId)
        && (!from || timestamp >= Date.parse(from)) && (!to || timestamp <= Date.parse(to));
      if (!matches) return;
      const oldest = [...entries.values()].sort(compareEntries).at(-1);
      if (cursor && oldest && compareEntries(item, oldest) > 0 && !entries.has(item.id)) return;
      changedDuringRequest.add(item.id);
      entries.set(item.id, item);
      publish();
    });
    // The history remains available even when the event stream cannot connect.
    void load(true);
    return () => {
      controller.abort();
      events.close();
    };
  }, [query]);

  return { ...state, loadMore };
}
