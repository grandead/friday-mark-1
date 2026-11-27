import { useCallback, useEffect, useRef, useState } from 'react';
import { userError } from '@/lib/errors';
import { getJson } from '@/lib/get-json';
import type { Task } from '@/lib/tasks';

type State = { tasks: Task[] | null; error: string; reconnecting: boolean };
type SetState = React.Dispatch<React.SetStateAction<State>>;
type Change = { id: string; task: Task | null };

export function useTasks() {
  const [state, setState] = useState<State>({ tasks: null, error: '', reconnecting: false });
  const feed = useRef<TaskFeed | null>(null);
  useEffect(() => connect(feed, setState), []);
  const refresh = useCallback(() => feed.current?.load(), []);
  return { ...state, refresh };
}

function connect(ref: { current: TaskFeed | null }, setState: SetState) {
  const feed = new TaskFeed(setState);
  ref.current = feed;
  feed.start();
  return () => disconnect(ref, feed);
}

function disconnect(ref: { current: TaskFeed | null }, feed: TaskFeed) {
  ref.current = null;
  feed.close();
}

function applyChange(tasks: Map<string, Task>, { id, task }: Change) {
  if (task) tasks.set(id, task);
  else tasks.delete(id);
}

class TaskFeed {
  private readonly events = new EventSource('/api/tasks/live');
  private tasks = new Map<string, Task>();
  private changes = new Map<string, Change>();
  private request?: AbortController;

  constructor(private readonly setState: SetState) {}

  start() {
    this.events.onopen = () => this.open();
    this.events.onerror = () => this.setState((state) => ({ ...state, reconnecting: true }));
    this.events.addEventListener('task.updated', (event) => this.update(event));
    this.events.addEventListener('task.deleted', (event) => this.update(event));
    void this.load();
  }

  close() {
    this.events.close();
    this.request?.abort();
  }

  private open() {
    this.setState((state) => ({ ...state, reconnecting: false }));
    void this.load();
  }

  async load() {
    this.request?.abort();
    const request = new AbortController();
    this.request = request;
    this.changes.clear();
    try {
      const snapshot = await getJson<Task[]>('/api/tasks', request.signal);
      if (request.signal.aborted) return;
      this.tasks.clear();
      for (const task of snapshot) this.tasks.set(task.id, task);
      // Replay updates and deletions received while the snapshot was in flight.
      for (const change of this.changes.values()) applyChange(this.tasks, change);
      this.render();
      this.setState((state) => ({ ...state, error: '' }));
    } catch (error) {
      if (request.signal.aborted) return;
      const message = userError(error);
      this.setState((state) => ({ ...state, error: message }));
    } finally {
      if (this.request === request) {
        this.request = undefined;
        this.changes.clear();
      }
    }
  }

  private update(event: MessageEvent<string>) {
    const change: Change = JSON.parse(event.data);
    if (this.request) this.changes.set(change.id, change);
    applyChange(this.tasks, change);
    this.render();
  }

  private render() {
    const tasks = [...this.tasks.values()].sort(
      (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    );
    this.setState((state) => ({ ...state, tasks }));
  }
}
