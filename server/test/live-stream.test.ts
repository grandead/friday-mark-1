import assert from 'node:assert/strict';
import test from 'node:test';
import { createLiveStream } from '../src/services/live-stream';
import { publish } from '../src/services/signals';

const TIMEOUT_MS = 5000;

declare module '../src/services/signals/service' {
  interface Signals {
    'test.message': { text: string };
    'test.counter': { value: number };
  }
}

type Handlers = Parameters<typeof createLiveStream>[1];
type Reader = ReadableStreamDefaultReader<Uint8Array>;

async function openStream(t: test.TestContext, handlers: Handlers) {
  const abort = new AbortController();
  const stream = createLiveStream(abort.signal, handlers);
  const reader = stream.getReader();
  t.after(() => cancelStream(abort, reader));
  const connected = await reader.read();
  const decoder = new TextDecoder();
  const frame = decoder.decode(connected.value);
  assert.equal(frame, ': connected\n\n');
  return { reader, abort };
}

async function cancelStream(abort: AbortController, reader: Reader) {
  abort.abort();
  await reader.cancel();
}

async function readEvent(reader: Reader) {
  const chunk = await reader.read();
  assert.equal(chunk.done, false);
  const decoder = new TextDecoder();
  const frame = decoder.decode(chunk.value);
  const [eventLine, dataLine] = frame.split('\n');
  const name = eventLine.slice('event: '.length);
  const json = dataLine.slice('data: '.length);
  const data: unknown = JSON.parse(json);
  return { name, data };
}

function flush() {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

async function messageData(payload: { text: string }, wait?: Promise<void>) {
  await wait;
  if (payload.text === 'fail') throw new Error('Event handler failed');
  return { message: payload.text };
}

function counterData(payload: { value: number }) {
  return payload.value;
}

test(
  'live stream dispatches multiple signal payloads and preserves their shared order',
  {
    timeout: TIMEOUT_MS,
  },
  dispatchesSignals,
);

async function dispatchesSignals(t: test.TestContext) {
  const pending = Promise.withResolvers<void>();
  t.after(() => pending.resolve());
  const message = t.mock.fn((payload: { text: string }) => messageData(payload, pending.promise));
  const counter = t.mock.fn(counterData);
  const handlers = { 'test.message': message, 'test.counter': counter };
  const { reader } = await openStream(t, handlers);
  publish('interaction.updated', { id: 'unsubscribed' });
  publish('test.message', { text: 'hello' });
  publish('test.counter', { value: 0 });
  await flush();
  const waitingCalls = counter.mock.callCount();
  assert.equal(waitingCalls, 0);
  pending.resolve();
  const first = await readEvent(reader);
  const second = await readEvent(reader);
  assert.deepEqual(first, { name: 'test.message', data: { message: 'hello' } });
  assert.deepEqual(second, { name: 'test.counter', data: 0 });
  const messageCalls = message.mock.callCount();
  const counterCalls = counter.mock.callCount();
  assert.equal(messageCalls, 1);
  assert.equal(counterCalls, 1);
}

test('a null handler result skips only its event', { timeout: TIMEOUT_MS }, skipsNull);

async function skipsNull(t: test.TestContext) {
  const handlers = { 'test.message': () => null, 'test.counter': counterData };
  const { reader } = await openStream(t, handlers);
  publish('test.message', { text: 'skip' });
  publish('test.counter', { value: 7 });
  const event = await readEvent(reader);
  assert.deepEqual(event, { name: 'test.counter', data: 7 });
}

test(
  'abort, cancellation and handler failures remove every signal subscription',
  {
    timeout: TIMEOUT_MS,
  },
  removesSubscriptions,
);

async function removesSubscriptions(t: test.TestContext) {
  const errors: unknown[][] = [];
  t.mock.method(console, 'error', (...args: unknown[]) => errors.push(args));
  for (const mode of ['abort', 'cancel', 'failure']) {
    await verifyCleanup(t, mode);
  }
  const deliveryErrors = errors.filter(([message]) => message === 'Failed to send live event:');
  assert.equal(deliveryErrors.length, 1);
}

async function verifyCleanup(t: test.TestContext, mode: string) {
  const message = t.mock.fn(messageData);
  const counter = t.mock.fn(counterData);
  const handlers = { 'test.message': message, 'test.counter': counter };
  const { reader, abort } = await openStream(t, handlers);
  if (mode === 'cancel') await reader.cancel();
  else if (mode === 'abort') abort.abort();
  else publish('test.message', { text: 'fail' });
  const result = await reader.read();
  assert.equal(result.done, true);
  publish('test.message', { text: 'after-close' });
  publish('test.counter', { value: 1 });
  await flush();
  const messageCalls = message.mock.callCount();
  const counterCalls = counter.mock.callCount();
  assert.equal(messageCalls, mode === 'failure' ? 1 : 0);
  assert.equal(counterCalls, 0);
}

test(
  'closing one live stream leaves another stream subscribed',
  {
    timeout: TIMEOUT_MS,
  },
  isolatesStreams,
);

async function isolatesStreams(t: test.TestContext) {
  const firstHandler = t.mock.fn(counterData);
  const secondHandler = t.mock.fn(counterData);
  const first = await openStream(t, { 'test.counter': firstHandler });
  const second = await openStream(t, { 'test.counter': secondHandler });
  publish('test.counter', { value: 1 });
  const firstEvent = await readEvent(first.reader);
  const secondEvent = await readEvent(second.reader);
  assert.deepEqual(firstEvent, secondEvent);

  first.abort.abort();
  const closed = await first.reader.read();
  assert.equal(closed.done, true);
  publish('test.counter', { value: 2 });
  const next = await readEvent(second.reader);
  assert.deepEqual(next, { name: 'test.counter', data: 2 });
  const firstCalls = firstHandler.mock.callCount();
  const secondCalls = secondHandler.mock.callCount();
  assert.equal(firstCalls, 1);
  assert.equal(secondCalls, 2);
}
