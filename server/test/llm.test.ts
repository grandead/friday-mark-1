import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import {
  createServer,
  type IncomingMessage,
  type RequestListener,
  type ServerResponse,
} from 'node:http';
import test, { after, beforeEach, mock } from 'node:test';
import { DEVICE_ID as deviceId, USER_ID as userId } from '../src/config/identity';
import { LLM_CONFIG } from '../src/config/llm';
import type { ChatMessage, ToolDefinition } from '../src/services/llm';
import { createAssistant } from './assistant';
import { createTestDatabase } from './database';

const reply = {
  model: 'test-model',
  done: true,
  done_reason: 'stop',
  message: { content: ' Привет! ', thinking: 'private reasoning' },
  prompt_eval_count: 12,
  eval_count: 3,
};
const BEFORE_CONFIG = { ...LLM_CONFIG };
const RUNTIME_URL = new URL('../src/services/runtime/index.ts', import.meta.url);
let shutdown = new AbortController();

mock.module(RUNTIME_URL, { namedExports: { getShutdownSignal: () => shutdown.signal } });
const { generateResponse } = await import('../src/services/llm');

beforeEach(resetConfig);
after(() => Object.assign(LLM_CONFIG, BEFORE_CONFIG));

function resetConfig() {
  Object.assign(LLM_CONFIG, BEFORE_CONFIG, { model: 'test-model', timeoutMs: 2000 });
  shutdown = new AbortController();
}

async function endpoint(t: test.TestContext, handler: RequestListener) {
  const server = createServer(handler).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    return new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const address = server.address() as { port: number };
  LLM_CONFIG.baseUrl = `http://127.0.0.1:${address.port}`;
  return LLM_CONFIG.baseUrl;
}
type OllamaRequest = {
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  think: boolean;
  stream: boolean;
  options: { num_predict: number; temperature: number };
};

test('Ollama requests bounded non-thinking chat and exposes only the spoken answer', async (t) => {
  let received: OllamaRequest | undefined;
  await endpoint(t, async (req, res) => {
    assert.equal(req.url, '/api/chat');
    assert.equal(req.method, 'POST');
    let body = '';
    for await (const chunk of req) body += chunk;
    received = JSON.parse(body);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(reply));
  });
  const messages: ChatMessage[] = [{ role: 'user', content: 'Привет' }];
  const result = await generateResponse(messages);
  assert.equal(result.text, 'Привет!');
  assert.equal(result.inputTokens, 12);
  assert.ok(received);
  assert.deepEqual(received.messages, messages);
  assert.equal(received.think, false);
  assert.equal(received.stream, false);
  assert.equal(received.options.num_predict, 512);
});

for (const [name, status, body, error] of [
  ['missing model', 404, { error: 'model not found' }, /HTTP 404.*model not found/],
  ['empty answer', 200, { ...reply, message: { content: '' } }, /empty or invalid/],
  ['unfinished answer', 200, { ...reply, done: false }, /empty or invalid/],
  ['truncated answer', 200, { ...reply, done_reason: 'length' }, /output token limit/],
  [
    'thinking budget exhausted without an answer',
    200,
    { ...reply, done_reason: 'length', message: { content: '', thinking: 'private reasoning' } },
    /output token limit/,
  ],
  [
    'tool call',
    200,
    { ...reply, message: { content: 'Invoke', tool_calls: [{}] } },
    /empty or invalid/,
  ],
] as const) {
  test(`Ollama rejects ${name}`, async (t) => {
    await endpoint(t, (_req, res) => {
      res.statusCode = status;
      res.end(JSON.stringify(body));
    });
    await assert.rejects(generateResponse([]), error);
  });
}

test('Ollama timeout and shutdown cancel the request', async (t) => {
  await endpoint(t, () => {});
  LLM_CONFIG.timeoutMs = 30;
  await assert.rejects(generateResponse([]), /did not respond/);
  LLM_CONFIG.timeoutMs = 2000;
  const pending = generateResponse([]);
  shutdown.abort();
  await assert.rejects(pending, /server shutdown/);
});

test('Ollama preserves HTTP errors with a non-JSON body', rejectsNonJsonHttpError);
test('Ollama rejects a successful response with invalid JSON', rejectsInvalidJson);
test('Ollama timeout covers reading the response body', cancelsResponseBody);
test('Ollama does not send requests after shutdown', rejectsAfterShutdown);

async function rejectsNonJsonHttpError(t: test.TestContext) {
  const handler = sendRawResponse.bind(null, 503, '<html>Unavailable</html>');
  await endpoint(t, handler);
  const pending = generateResponse([]);
  await assert.rejects(pending, { code: 'llm_http_error' });
}

async function rejectsInvalidJson(t: test.TestContext) {
  const handler = sendRawResponse.bind(null, 200, '{');
  await endpoint(t, handler);
  const pending = generateResponse([]);
  await assert.rejects(pending, { code: 'invalid_llm_reply' });
}

async function cancelsResponseBody(t: test.TestContext) {
  await endpoint(t, sendIncompleteResponse);
  LLM_CONFIG.timeoutMs = 100;
  const pending = generateResponse([]);
  await assert.rejects(pending, { code: 'llm_timeout' });
}

async function rejectsAfterShutdown(t: test.TestContext) {
  const fetchMock = t.mock.method(globalThis, 'fetch');
  shutdown.abort();
  const pending = generateResponse([]);
  await assert.rejects(pending, { code: 'processing_stopped' });
  const calls = fetchMock.mock.callCount();
  assert.equal(calls, 0);
}

function sendRawResponse(status: number, body: string, _req: IncomingMessage, res: ServerResponse) {
  res.statusCode = status;
  res.end(body);
}

function sendIncompleteResponse(_req: IncomingMessage, res: ServerResponse) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.write('{');
}

test('assistant isolates users, keeps recent chronological history across devices, and records failures', async (t) => {
  const database = await createTestDatabase();
  t.after(() => database.close());
  const db = database.db;
  const otherUser = await db.orm.public.User.create({ displayName: 'Other' });
  const otherDevice = await db.orm.public.Device.create({ displayName: 'Other device' });
  const now = new Date();
  for (let index = 0; index < 8; index++) {
    await db.orm.public.Interaction.create({
      userId,
      deviceId: index === 7 ? otherDevice.id : deviceId,
      status: 'complete',
      startedAt: new Date(+now - (10 - index) * 60_000),
      inputAudioKey: `test-${index}.wav`,
      transcript: `question ${index}`,
      responseText: `answer ${index}`,
    });
  }
  for (const extra of [
    { userId: otherUser.id },
    { startedAt: new Date(+now - 31 * 60_000) },
    { status: 'failed' },
    { startedAt: new Date(+now + 60_000) },
  ])
    await db.orm.public.Interaction.create({
      userId,
      deviceId,
      status: 'complete',
      startedAt: new Date(+now - 1000),
      inputAudioKey: `${randomUUID()}.wav`,
      transcript: 'secret',
      responseText: 'excluded',
      ...extra,
    });
  const current = await db.orm.public.Interaction.create({
    userId,
    deviceId,
    startedAt: now,
    status: 'processing',
    inputAudioKey: 'current.wav',
  });
  let messages: ChatMessage[] = [];
  let fail = false;
  const assistant = createAssistant(db, async (received) => {
    messages = received;
    if (fail) throw new Error('offline');
    return { text: 'Ответ', model: 'test', durationMs: 10, inputTokens: 12, outputTokens: 3 };
  });
  assert.equal(await assistant(current.id, 'current question'), 'Ответ');
  assert.equal(messages.length, 14);
  assert.match(messages[0].content, new RegExp(userId));
  assert.match(messages[0].content, /Всегда отвечай на русском/);
  assert.match(messages[0].content, /Каталог|каталог/);
  assert.equal(messages[1].content, 'question 2');
  assert.equal(messages[11].content, 'question 7');
  assert.equal(messages.at(-1)!.content, 'current question');
  assert.ok(!JSON.stringify(messages).includes('secret'));
  const action = await db.orm.public.InteractionAction.firstOrThrow({
    interactionId: current.id,
  });
  assert.deepEqual(action.arguments, { model: LLM_CONFIG.model, historyTurns: 6 });
  assert.deepEqual(action.result, {
    model: 'test',
    durationMs: 10,
    inputTokens: 12,
    outputTokens: 3,
  });
  const longQuestion = await db.orm.public.Interaction.create({
    userId,
    deviceId,
    startedAt: now,
    status: 'processing',
    inputAudioKey: 'long.wav',
  });
  await assistant(longQuestion.id, 'я'.repeat(5999));
  assert.equal(messages.length, 2, 'History must fit the character budget');
  await assert.rejects(assistant(longQuestion.id, 'я'.repeat(6001)), /conversation length limit/);
  const separate = await db.orm.public.Interaction.create({
    userId: otherUser.id,
    deviceId,
    startedAt: new Date(+now - 2000),
    status: 'processing',
    inputAudioKey: 'separate.wav',
  });
  fail = true;
  await assert.rejects(assistant(separate.id, 'Привет'), /offline/);
  assert.equal(messages.length, 2);
  assert.match(messages[0].content, /Other/);
  const failure = await db.orm.public.InteractionAction.firstOrThrow({
    interactionId: separate.id,
  });
  assert.match(failure.error!, /offline/);
});

test('Ollama transports multiple typed tool calls with empty content and rejects unrequested tools', async (t) => {
  let received: OllamaRequest | undefined;
  const toolCall = {
    function: {
      name: 'smartmi_get_state',
      arguments: { deviceId: '019ace9d-0000-7000-8000-000000000001' },
    },
  };
  const toolCalls = [
    toolCall,
    {
      function: {
        name: 'smartmi_get_state',
        arguments: { deviceId: '019ace9d-0000-7000-8000-000000000002' },
      },
    },
  ];
  await endpoint(t, async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    received = JSON.parse(body);
    res.end(JSON.stringify({ ...reply, message: { content: '', tool_calls: toolCalls } }));
  });
  const { TOOL_DEFINITIONS } = await import('../src/services/llm-tools');
  const result = await generateResponse(
    [{ role: 'user', content: 'Как бризер?' }],
    TOOL_DEFINITIONS,
  );
  assert.deepEqual(result.toolCalls, toolCalls);
  assert.equal(result.text, '');
  assert.ok(received);
  assert.deepEqual(received.tools, TOOL_DEFINITIONS);
  assert.equal(received.options.temperature, 0);
  assert.equal(received.think, true);
  assert.equal(received.options.num_predict, 2048);
  await assert.rejects(generateResponse([]), /not allowed/);
});

test('foreign replies get one tool-free Russian repair; repeated failure returns Russian fallback', async (t) => {
  const database = await createTestDatabase();
  t.after(() => database.close());
  const db = database.db;
  const { createHomeTools } = await import('./home-tools');
  let calls = 0;
  let repairText = 'Привет!';
  let returnTool = false;
  const llm = async (_messages: ChatMessage[], tools?: unknown) => {
    calls++;
    if (calls % 2 === 0)
      assert.equal(tools, undefined, 'Language repair must not receive device tools');
    else assert.ok(Array.isArray(tools) && tools.length > 0);
    return {
      text: calls % 2 ? 'Hello!' : repairText,
      ...(returnTool && calls % 2 === 0
        ? {
            toolCalls: [
              {
                function: {
                  name: 'smartmi_set_power',
                  arguments: { deviceId: '019ace9d-0000-7000-8000-000000000001', power: true },
                },
              },
            ],
          }
        : {}),
      model: 'test',
      durationMs: 1,
      inputTokens: 2,
      outputTokens: 3,
    };
  };
  const assistant = createAssistant(
    db,
    llm,
    createHomeTools(db, async () => {
      assert.fail('Language repair must not execute device commands');
    }),
  );
  for (const scenario of ['translated', 'still_foreign', 'unrequested_tool'] as const) {
    calls = 0;
    repairText = scenario === 'still_foreign' ? 'Hello again!' : 'Привет!';
    returnTool = scenario === 'unrequested_tool';
    const row = await db.orm.public.Interaction.create({
      userId,
      deviceId,
      status: 'processing',
      inputAudioKey: `${randomUUID()}.wav`,
    });
    const text = await assistant(row.id, 'Please answer in English.');
    assert.equal(calls, 2, 'Repair is bounded to one call');
    assert.match(text, /[А-Яа-яЁё]/);
    if (scenario === 'translated') assert.equal(text, 'Привет!');
    else assert.match(text, /Не удалось сформулировать ответ на русском/);
    const actions = await db.orm.public.InteractionAction.where({ interactionId: row.id })
      .orderBy((r) => r.sequence.asc())
      .all();
    assert.deepEqual(
      actions.map((a) => a.operation),
      ['chat', 'translate_reply'],
    );
    if (scenario !== 'translated') assert.doesNotMatch(actions[1].error!, /[А-Яа-яЁё]/);
  }
});

test('nine calls pass transport validation but execute no commands', async (t) => {
  const database = await createTestDatabase();
  t.after(() => database.close());
  const calls = Array.from({ length: 9 }, excessCall);
  const payload = JSON.stringify({ ...reply, message: { content: '', tool_calls: calls } });
  await endpoint(t, (_request, response) => response.end(payload));
  const { generateResponse: generate } = await import('../src/services/llm/generate-response');
  const assistant = createAssistant(database.db, generate);
  const row = await database.db.orm.public.Interaction.select('id').create({
    userId,
    deviceId,
    status: 'processing',
    inputAudioKey: 'limit.wav',
  });
  const answer = await assistant(row.id, 'Включи всё');
  assert.match(answer, /до восьми команд/);
  const actions = await database.db.orm.public.InteractionAction.select('operation', 'error')
    .where({ interactionId: row.id })
    .orderBy((action) => action.sequence.asc())
    .all();
  assert.deepEqual(actions, [
    { operation: 'chat', error: null },
    { operation: 'reject_batch', error: null },
  ]);
});

function excessCall() {
  return {
    function: {
      name: 'smartmi_set_power',
      arguments: { deviceId: '019ace9d-0000-7000-8000-000000000001', power: true },
    },
  };
}
