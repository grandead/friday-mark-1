import assert from 'node:assert/strict';
import test, { mock } from 'node:test';

const PROCESS_MODULE_URL = new URL(
  '../src/services/interactions/process-interaction.ts',
  import.meta.url,
);
const TIMEOUT_MS = 5000;
const AUDIO = new Uint8Array();
let processJob: (id: string) => Promise<void>;

mock.module(PROCESS_MODULE_URL, {
  cache: true,
  namedExports: { processInteraction: (id: string) => processJob(id) },
});
const {
  reserveInteraction,
  releaseInteraction,
  enqueueInteraction,
  getPendingInteractionCount,
  waitForInteractions,
} = await import('../src/services/interactions');

function ignoreEvent() {}

function flush() {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

async function runJob(id: string, started: string[], pending: Promise<void>) {
  started.push(id);
  if (id === 'first') await pending;
  if (id === 'failed') throw new Error('Interaction failed');
}

test(
  'interaction queue runs jobs in order, survives failures and drains all pending work',
  {
    timeout: TIMEOUT_MS,
  },
  runsSequentially,
);

async function runsSequentially(t: test.TestContext) {
  const first = Promise.withResolvers<void>();
  t.after(() => first.resolve());
  const started: string[] = [];
  const errors: unknown[][] = [];
  t.mock.method(console, 'error', (...args: unknown[]) => errors.push(args));
  processJob = (id) => runJob(id, started, first.promise);
  enqueueInteraction('first', { wav: AUDIO, path: 'first.wav' }, ignoreEvent);
  enqueueInteraction('failed', { wav: AUDIO, path: 'failed.wav' }, ignoreEvent);
  enqueueInteraction('last', { wav: AUDIO, path: 'last.wav' }, ignoreEvent);
  const pendingCount = getPendingInteractionCount();
  assert.equal(pendingCount, 3);
  let drained = false;
  const drain = waitForInteractions().then(() => (drained = true));
  await flush();
  assert.deepEqual(started, ['first']);
  assert.equal(drained, false);
  first.resolve();
  await drain;
  assert.deepEqual(started, ['first', 'failed', 'last']);
  const remaining = getPendingInteractionCount();
  assert.equal(remaining, 0);
  const failures = errors.filter(([message]) => message === 'Failed to process interaction:');
  assert.equal(failures.length, 1);
}

test(
  'separately loaded queue modules share pending work and completion',
  {
    timeout: TIMEOUT_MS,
  },
  sharesQueue,
);

async function sharesQueue(t: test.TestContext) {
  const url = new URL('../src/services/interactions/queue.ts', import.meta.url);
  url.searchParams.set('instance', 'second');
  const other: typeof import('../src/services/interactions/queue') = await import(url.href);
  const first = Promise.withResolvers<void>();
  t.after(() => first.resolve());
  const started: string[] = [];
  processJob = (id) => runJob(id, started, first.promise);
  other.enqueueInteraction('first', { wav: AUDIO, path: 'first.wav' }, ignoreEvent);
  enqueueInteraction('second', { wav: AUDIO, path: 'second.wav' }, ignoreEvent);
  await flush();
  assert.deepEqual(started, ['first']);
  const pendingCount = getPendingInteractionCount();
  const otherPendingCount = other.getPendingInteractionCount();
  assert.equal(pendingCount, 2);
  assert.equal(otherPendingCount, pendingCount);
  const completion = waitForInteractions();
  const otherCompletion = other.waitForInteractions();
  assert.strictEqual(completion, otherCompletion);
  first.resolve();
  await otherCompletion;
  assert.deepEqual(started, ['first', 'second']);
  const remaining = getPendingInteractionCount();
  assert.equal(remaining, 0);
}

test(
  'a reconnect cannot claim a recording slot reserved by the previous connection',
  checkCapacity,
);

async function checkCapacity(t: test.TestContext) {
  const gate = Promise.withResolvers<void>();
  processJob = () => gate.promise;
  t.after(() => gate.resolve());
  for (const id of ['one', 'two', 'three'])
    enqueueInteraction(id, { wav: AUDIO, path: id }, ignoreEvent);
  reserveInteraction('recording');
  t.after(() => releaseInteraction('recording'));
  assert.throws(() => reserveInteraction('replacement'), { code: 'interaction_queue_full' });
  releaseInteraction('recording');
  reserveInteraction('replacement');
  enqueueInteraction('replacement', { wav: AUDIO, path: 'replacement.wav' }, ignoreEvent);
  const count = getPendingInteractionCount();
  assert.equal(count, 4);
  gate.resolve();
  await waitForInteractions();
  const drained = getPendingInteractionCount();
  assert.equal(drained, 0);
}
