import { AsyncResource } from 'node:async_hooks';

export interface Signals {
  'interaction.updated': { id: string };
}
type Subscriptions = {
  [Name in keyof Signals]?: Map<symbol, (payload: Signals[Name]) => void | Promise<void>>;
};

const state = globalThis as typeof globalThis & { fridaySignalSubscriptions?: Subscriptions };
state.fridaySignalSubscriptions ??= {};
const subscriptions = state.fridaySignalSubscriptions;

export function subscribe<Name extends keyof Signals>(
  name: Name,
  listener: (payload: Signals[Name]) => void | Promise<void>,
) {
  const subscription = Symbol(name);
  const boundListener = AsyncResource.bind(listener);
  const listeners =
    subscriptions[name] ?? new Map<symbol, (payload: Signals[Name]) => void | Promise<void>>();
  // The map and its listeners use the same signal name.
  subscriptions[name] = listeners as Subscriptions[Name];
  listeners.set(subscription, boundListener);
  return subscription;
}

export function unsubscribe(subscription: symbol) {
  const groups = Object.values(subscriptions);
  for (const listeners of groups) listeners?.delete(subscription);
}

export function publish<Name extends keyof Signals>(name: Name, payload: Signals[Name]) {
  const listeners = subscriptions[name];
  if (!listeners) return;
  for (const [subscription, listener] of listeners) {
    const pending = Promise.resolve();
    void pending
      .then(() => notifyListener(listeners, subscription, listener, payload))
      .catch((error) => console.error(`Signal subscriber failed (${name}):`, error));
  }
}

function notifyListener<Payload>(
  listeners: Map<symbol, (payload: Payload) => void | Promise<void>>,
  subscription: symbol,
  listener: (payload: Payload) => void | Promise<void>,
  payload: Payload,
) {
  if (listeners.has(subscription)) return listener(payload);
}
