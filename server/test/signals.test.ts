import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import test from 'node:test';
import { publish, subscribe, unsubscribe } from '../src/services/signals';

function flush() {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

test('signals fan out, preserve subscriber context and unsubscribe individual subscriptions', async (t) => {
  const context = new AsyncLocalStorage<string>();
  const received: string[] = [];
  const listener = ({ id }: { id: string }) => {
    received.push(`${context.getStore()}:${id}`);
  };
  const first = context.run('first', () => subscribe('interaction.updated', listener));
  const second = context.run('second', () => subscribe('interaction.updated', listener));
  t.after(() => {
    unsubscribe(first);
    unsubscribe(second);
  });
  publish('interaction.updated', { id: 'one' });
  assert.deepEqual(received, []);
  await flush();
  assert.deepEqual(received, ['first:one', 'second:one']);

  publish('interaction.updated', { id: 'two' });
  unsubscribe(first);
  unsubscribe(first);
  await flush();
  assert.deepEqual(received, ['first:one', 'second:one', 'second:two']);
});

test('slow or failed signal listeners do not block publishing or other listeners', async (t) => {
  const errors: unknown[][] = [];
  t.mock.method(console, 'error', (...args: unknown[]) => errors.push(args));
  const pending = Promise.withResolvers<void>();
  let received = 0;
  const subscriptions = [
    subscribe('interaction.updated', () => pending.promise),
    subscribe('interaction.updated', () => {
      throw new Error('Synchronous listener failure');
    }),
    subscribe('interaction.updated', async () => {
      throw new Error('Asynchronous listener failure');
    }),
    subscribe('interaction.updated', () => {
      received++;
    }),
  ];
  t.after(() => {
    for (const subscription of subscriptions) unsubscribe(subscription);
    pending.resolve();
  });
  const result = publish('interaction.updated', { id: 'one' });
  assert.equal(result, undefined);
  await flush();
  assert.equal(received, 1);
  assert.equal(errors.length, 2);
});

test('separately loaded signal modules share one subscription store', async (t) => {
  const url = new URL('../src/services/signals/service.ts', import.meta.url);
  url.searchParams.set('instance', 'second');
  const other: typeof import('../src/services/signals') = await import(url.href);
  const received: string[] = [];
  const subscription = subscribe('interaction.updated', ({ id }) => {
    received.push(id);
  });
  t.after(() => unsubscribe(subscription));
  other.publish('interaction.updated', { id: 'shared' });
  await flush();
  assert.deepEqual(received, ['shared']);
  other.unsubscribe(subscription);
  publish('interaction.updated', { id: 'removed' });
  await flush();
  assert.deepEqual(received, ['shared']);
});
