import test from 'node:test';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { createServer, type RequestListener } from 'node:http';
import { once } from 'node:events';
import { createOllama } from '../src/services/llm/ollama.js';
import { createAssistant } from '../src/services/assistant/reply.js';
import { createTestDatabase } from './database.js';
import { deviceId, userId } from '../src/config/identity.js';
import type { ChatMessage } from '../src/services/llm/types.js';

async function endpoint(t: test.TestContext, handler: RequestListener) {
  const server = createServer(handler).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); return new Promise<void>(resolve => server.close(() => resolve())); });
  const address = server.address() as { port: number };
  return `http://127.0.0.1:${address.port}`;
}
const reply = { model: 'test-model', done: true, done_reason: 'stop', message: { content: ' Привет! ', thinking: 'private reasoning' }, prompt_eval_count: 12, eval_count: 3 };
const options = { model: 'test-model', timeoutMs: 2000, signal: new AbortController().signal };

test('Ollama requests bounded non-thinking chat and exposes only the spoken answer', async t => {
  let received: any;
  const baseUrl = await endpoint(t, async (req, res) => {
    assert.equal(req.url, '/api/chat');
    assert.equal(req.method, 'POST');
    let body = '';
    for await (const chunk of req) body += chunk;
    received = JSON.parse(body);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(reply));
  });
  const messages: ChatMessage[] = [{ role: 'user', content: 'Привет' }];
  const result = await createOllama({ ...options, baseUrl }).generate(messages);
  assert.equal(result.text, 'Привет!');
  assert.equal(result.inputTokens, 12);
  assert.deepEqual(received.messages, messages);
  assert.equal(received.think, false);
  assert.equal(received.stream, false);
  assert.equal(received.options.num_predict, 512);
});

for (const [name, status, body, error] of [
  ['missing model', 404, { error: 'model not found' }, /HTTP 404.*model not found/],
  ['empty answer', 200, { ...reply, message: { content: '' } }, /пустой или некорректный/],
  ['unfinished answer', 200, { ...reply, done: false }, /пустой или некорректный/],
  ['truncated answer', 200, { ...reply, done_reason: 'length' }, /лимит длины/],
  ['tool call', 200, { ...reply, message: { content: 'Invoke', tool_calls: [{}] } }, /инструментов/],
] as const) {
  test(`Ollama rejects ${name}`, async t => {
    const baseUrl = await endpoint(t, (_req, res) => { res.statusCode = status; res.end(JSON.stringify(body)); });
    await assert.rejects(createOllama({ ...options, baseUrl }).generate([]), error);
  });
}

test('Ollama timeout and shutdown cancel the request', async t => {
  const baseUrl = await endpoint(t, () => {});
  await assert.rejects(createOllama({ ...options, baseUrl, timeoutMs: 30 }).generate([]), /не ответила/);
  const shutdown = new AbortController();
  const pending = createOllama({ ...options, baseUrl, signal: shutdown.signal }).generate([]);
  shutdown.abort();
  await assert.rejects(pending, /остановлена/);
});

test('assistant isolates users, keeps recent chronological history across devices, and records failures', async t => {
  const database = await createTestDatabase();
  t.after(() => database.close());
  const db = database.db;
  const otherUser = await db.user.create({ data: { displayName: 'Other' } });
  const otherDevice = await db.device.create({ data: { displayName: 'Other device' } });
  const now = new Date();
  for (let index = 0; index < 8; index++) {
    await db.interaction.create({ data: {
      userId, deviceId: index === 7 ? otherDevice.id : deviceId, status: 'complete',
      startedAt: new Date(+now - (10 - index) * 60_000), inputAudioKey: `test-${index}.wav`,
      transcript: `question ${index}`, responseText: `answer ${index}`,
    } });
  }
  for (const extra of [
    { userId: otherUser.id }, { startedAt: new Date(+now - 31 * 60_000) },
    { status: 'failed' }, { startedAt: new Date(+now + 60_000) },
  ]) await db.interaction.create({ data: {
    userId, deviceId, status: 'complete', startedAt: new Date(+now - 1000),
    inputAudioKey: randomUUID() + '.wav', transcript: 'secret', responseText: 'excluded', ...extra,
  } });
  const current = await db.interaction.create({ data: { userId, deviceId, startedAt: now, status: 'processing', inputAudioKey: 'current.wav' } });
  let messages: ChatMessage[] = [];
  let fail = false;
  const assistant = createAssistant(db, { provider: 'ollama', model: 'test', generate: async received => {
    messages = received;
    if (fail) throw new Error('offline');
    return { text: 'Ответ', model: 'test', durationMs: 10, inputTokens: 12, outputTokens: 3 };
  } });
  assert.equal(await assistant(current.id, 'current question'), 'Ответ');
  assert.equal(messages.length, 14);
  assert.match(messages[0].content, new RegExp(userId));
  assert.equal(messages[1].content, 'question 2');
  assert.equal(messages[11].content, 'question 7');
  assert.equal(messages.at(-1)!.content, 'current question');
  assert.ok(!JSON.stringify(messages).includes('secret'));
  const action = await db.interactionAction.findFirstOrThrow({ where: { interactionId: current.id } });
  assert.deepEqual(action.arguments, { model: 'test', historyTurns: 6 });
  assert.deepEqual(action.result, { model: 'test', durationMs: 10, inputTokens: 12, outputTokens: 3 });
  const longQuestion = await db.interaction.create({ data: { userId, deviceId, startedAt: now, status: 'processing', inputAudioKey: 'long.wav' } });
  await assistant(longQuestion.id, 'я'.repeat(5999));
  assert.equal(messages.length, 2, 'History must fit the character budget');
  await assert.rejects(assistant(longQuestion.id, 'я'.repeat(6001)), /слишком длинная/);
  const separate = await db.interaction.create({ data: { userId: otherUser.id, deviceId, startedAt: new Date(+now - 2000), status: 'processing', inputAudioKey: 'separate.wav' } });
  fail = true;
  await assert.rejects(assistant(separate.id, 'Привет'), /offline/);
  assert.equal(messages.length, 2);
  assert.match(messages[0].content, /Other/);
  const failure = await db.interactionAction.findFirstOrThrow({ where: { interactionId: separate.id } });
  assert.match(failure.error!, /offline/);
});
