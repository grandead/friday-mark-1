import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import type { getInteraction } from '../src/app/api/interactions/live/_data/get-interaction';
import { publish } from '../src/services/signals';

type Interaction = NonNullable<Awaited<ReturnType<typeof getInteraction>>>;
const TIMEOUT_MS = 5000;
let readInteraction: (id: string) => Promise<Interaction | null>;
let shutdown = new AbortController();
mock.module(new URL('../src/app/api/interactions/live/_data/get-interaction.ts', import.meta.url), {
  cache: true,
  namedExports: { getInteraction: (id: string) => readInteraction(id) },
});
mock.module(new URL('../src/services/runtime/index.ts', import.meta.url), {
  cache: true,
  namedExports: { getShutdownSignal: () => shutdown.signal },
});
const { GET } = await import('../src/app/api/interactions/live/route');

function interaction(id: string): Interaction {
  return {
    id,
    deviceId: 'device',
    userId: 'user',
    startedAt: new Date('2026-11-26T10:00:00Z'),
    status: 'complete',
    transcript: 'Привет',
    responseText: 'Здравствуйте',
    responseSource: 'llm',
    error: null,
    inputAudioKey: 'input.wav',
    outputAudioKey: 'output.reply.wav',
    device: { id: 'device', displayName: 'Терминал' },
    user: { id: 'user', displayName: 'Пользователь' },
    actions: [],
  };
}

async function open(t: test.TestContext, read: typeof readInteraction) {
  readInteraction = read;
  shutdown = new AbortController();
  const abort = new AbortController();
  const request = new Request('http://localhost/api/interactions/live', { signal: abort.signal });
  const response = GET(request);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'text/event-stream');
  assert.ok(response.body);
  const reader = response.body.getReader();
  t.after(async () => {
    abort.abort();
    await reader.cancel();
  });
  const connected = await reader.read();
  const decoder = new TextDecoder();
  const frame = decoder.decode(connected.value);
  assert.equal(frame, ': connected\n\n');
  return { reader, abort, shutdown };
}

async function readEvent(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const chunk = await reader.read();
  assert.equal(chunk.done, false);
  const decoder = new TextDecoder();
  const frame = decoder.decode(chunk.value);
  assert.ok(frame.startsWith('event: interaction.updated\ndata: '));
  const data = frame.slice('event: interaction.updated\ndata: '.length);
  return JSON.parse(data);
}

function flush() {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

test('live reads changed records in signal order and reports audio availability', {
  timeout: TIMEOUT_MS,
}, async (t) => {
  const firstStarted = Promise.withResolvers<void>();
  const firstResult = Promise.withResolvers<Interaction>();
  const requested: string[] = [];
  const { reader } = await open(t, async (id) => {
    requested.push(id);
    if (id === 'first') {
      firstStarted.resolve();
      return firstResult.promise;
    }
    return interaction(id);
  });
  publish('interaction.updated', { id: 'first' });
  publish('interaction.updated', { id: 'second' });
  await firstStarted.promise;
  assert.deepEqual(requested, ['first']);
  const firstRow = interaction('first');
  firstRow.error = 'llm_timeout: private diagnostic';
  firstRow.actions = [
    {
      id: 'old-action',
      initiator: 'llm',
      service: 'smartHome',
      operation: 'command',
      arguments: {},
      result: null,
      error: 'Error: private diagnostic',
    },
  ];
  firstResult.resolve(firstRow);
  const first = await readEvent(reader);
  const second = await readEvent(reader);
  assert.equal(first.id, 'first');
  assert.equal(first.error.code, 'llm_timeout');
  assert.equal(first.actions[0].error.code, 'internal_error');
  const publicEntry = JSON.stringify(first);
  assert.doesNotMatch(publicEntry, /private diagnostic/);
  assert.equal(second.id, 'second');
  assert.deepEqual(requested, ['first', 'second']);
  assert.equal(first.startedAt, '2026-11-26T10:00:00.000Z');
  assert.equal(first.hasInputAudio, true);
  assert.equal(first.hasOutputAudio, true);
  assert.equal(first.inputAudio, undefined);
  assert.equal(first.outputAudio, undefined);
  assert.equal(first.inputAudioKey, undefined);
  assert.equal(first.outputAudioKey, undefined);
});

test(
  'live closes after a failed read so the client can reconnect',
  {
    timeout: TIMEOUT_MS,
  },
  closesAfterFailedRead,
);

async function closesAfterFailedRead(t: test.TestContext) {
  const errors: unknown[][] = [];
  t.mock.method(console, 'error', (...args: unknown[]) => errors.push(args));
  const read = t.mock.fn(readInteractionRow);
  const { reader } = await open(t, read);
  publish('interaction.updated', { id: 'failed' });
  publish('interaction.updated', { id: 'valid' });
  const result = await reader.read();
  assert.equal(result.done, true);
  await flush();
  const calls = read.mock.callCount();
  assert.equal(calls, 1);
  const deliveryErrors = errors.filter(([message]) => message === 'Failed to send live event:');
  assert.equal(deliveryErrors.length, 1);
}

test(
  'live skips missing records without closing the connection',
  {
    timeout: TIMEOUT_MS,
  },
  skipsMissingRecords,
);

async function skipsMissingRecords(t: test.TestContext) {
  const { reader } = await open(t, readInteractionRow);
  publish('interaction.updated', { id: 'missing' });
  publish('interaction.updated', { id: 'valid' });
  const entry = await readEvent(reader);
  assert.equal(entry.id, 'valid');
}

async function readInteractionRow(id: string) {
  if (id === 'failed') throw new Error('Database unavailable');
  return id === 'missing' ? null : interaction(id);
}

test('disconnect cancels queued reads and suppresses an in-flight response', {
  timeout: TIMEOUT_MS,
}, async (t) => {
  const started = Promise.withResolvers<void>();
  const pending = Promise.withResolvers<Interaction>();
  const requested: string[] = [];
  const { reader, abort } = await open(t, async (id) => {
    requested.push(id);
    started.resolve();
    return pending.promise;
  });
  publish('interaction.updated', { id: 'first' });
  publish('interaction.updated', { id: 'queued' });
  await started.promise;
  abort.abort();
  const result = await reader.read();
  assert.equal(result.done, true);
  const row = interaction('first');
  pending.resolve(row);
  publish('interaction.updated', { id: 'after-close' });
  await flush();
  assert.deepEqual(requested, ['first']);
});

test('stream cancellation and process shutdown remove live subscriptions', {
  timeout: TIMEOUT_MS,
}, async (t) => {
  let reads = 0;
  const read = async (id: string) => {
    reads++;
    return interaction(id);
  };
  const cancelled = await open(t, read);
  await cancelled.reader.cancel();
  publish('interaction.updated', { id: 'cancelled' });
  await flush();
  assert.equal(reads, 0);
  const stopped = await open(t, read);
  stopped.shutdown.abort();
  const result = await stopped.reader.read();
  assert.equal(result.done, true);
  publish('interaction.updated', { id: 'stopped' });
  await flush();
  assert.equal(reads, 0);
});

test(
  'live closes a slow reader before buffering all pending updates',
  {
    timeout: TIMEOUT_MS,
  },
  closesSlowReader,
);

async function closesSlowReader(t: test.TestContext) {
  const read = t.mock.fn(readLargeInteraction);
  const { reader } = await open(t, read);
  for (let index = 0; index < 10; index++) {
    const id = String(index);
    publish('interaction.updated', { id });
    await flush();
  }
  let received = 0;
  let chunk = await reader.read();
  while (!chunk.done) {
    received++;
    chunk = await reader.read();
  }
  assert.ok(received > 0 && received < 10);
  const calls = read.mock.callCount();
  assert.ok(calls < 10);
  publish('interaction.updated', { id: 'after-close' });
  await flush();
  const callsAfterClose = read.mock.callCount();
  assert.equal(callsAfterClose, calls);
}

async function readLargeInteraction(id: string) {
  const row = interaction(id);
  row.transcript = 'x'.repeat(64 * 1024);
  return row;
}

test(
  'live bounds queued work while an event is still loading',
  {
    timeout: TIMEOUT_MS,
  },
  boundsQueuedWork,
);

async function boundsQueuedWork(t: test.TestContext) {
  const pending = Promise.withResolvers<Interaction>();
  const read = t.mock.fn(() => pending.promise);
  const { reader } = await open(t, read);
  publish('interaction.updated', { id: 'first' });
  await flush();
  const calls = read.mock.callCount();
  assert.equal(calls, 1);
  for (let index = 0; index < 1000; index++) {
    const id = String(index);
    publish('interaction.updated', { id });
  }
  const result = await reader.read();
  assert.equal(result.done, true);
  const row = interaction('first');
  pending.resolve(row);
  await flush();
  const callsAfterClose = read.mock.callCount();
  assert.equal(callsAfterClose, 1);
}

test(
  'live sends heartbeats and clears their timer on disconnect',
  {
    timeout: TIMEOUT_MS,
  },
  cleansHeartbeat,
);

async function cleansHeartbeat(t: test.TestContext) {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const { reader, abort } = await open(t, readInteractionRow);
  t.mock.timers.tick(25_000);
  const chunk = await reader.read();
  const decoder = new TextDecoder();
  const frame = decoder.decode(chunk.value);
  assert.equal(frame, ': heartbeat\n\n');
  abort.abort();
  t.mock.timers.tick(50_000);
  const result = await reader.read();
  assert.equal(result.done, true);
}

test(
  'live immediately closes an already aborted request',
  {
    timeout: TIMEOUT_MS,
  },
  closesAbortedRequest,
);

async function closesAbortedRequest(t: test.TestContext) {
  const read = t.mock.fn(readInteractionRow);
  readInteraction = read;
  shutdown = new AbortController();
  const abort = new AbortController();
  abort.abort();
  const request = new Request('http://localhost/api/interactions/live', { signal: abort.signal });
  const response = GET(request);
  const reader = response.body!.getReader();
  t.after(() => reader.cancel());
  const result = await reader.read();
  assert.equal(result.done, true);
  publish('interaction.updated', { id: 'after-close' });
  await flush();
  const calls = read.mock.callCount();
  assert.equal(calls, 0);
}
