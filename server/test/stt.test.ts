import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { after, afterEach, before, beforeEach, mock, test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { wavHeader } from '../src/services/audio/wav';

const ENV_KEYS = ['WHISPER_BASE_URL', 'WHISPER_LANGUAGE', 'WHISPER_TIMEOUT_MS'] as const;
const BEFORE_ENV = ENV_KEYS.map((key) => [key, process.env[key]] as const);
const PCM = Buffer.from([0, 0, 255, 127, 0, 128]);
const HEADER = wavHeader(PCM.length, 20000);
const WAV = Buffer.concat([HEADER, PCM]);
const SERVER = createServer(handleRequest);
const RESPONSES = new Set<ServerResponse>();
const RUNTIME_URL = new URL('../src/services/runtime/index.ts', import.meta.url);
let shutdown = new AbortController();
let endpoint = '';
let responseBody = '';
let status = 200;
let hang: 'none' | 'headers' | 'body' = 'none';
let received = Promise.withResolvers<FormData>();

mock.module(RUNTIME_URL, { namedExports: { getShutdownSignal: () => shutdown.signal } });
const { transcribe } = await import('../src/services/stt');

before(startServer);
beforeEach(reset);
afterEach(checkCleanup);
after(stopServer);

test('sends WAV bytes and independent Russian transcription settings through HTTP', sendsAudio);
test('respects configured language and accepts empty speech', acceptsSilence);
test('rejects HTTP errors, error objects, malformed JSON and missing text', rejectsBadResponses);
test('limits upstream error diagnostics', boundsErrors);
test('times out waiting for response headers or body and closes the request', timesOut);
test('shutdown cancels the request and removes listeners', cancels);
test('already stopped requests do not connect', rejectsStopped);
test('invalid timeout configuration is rejected', rejectsInvalidTimeout);
test('connection failure is reported', rejectsConnectionFailure);

async function startServer() {
  await new Promise<void>((resolve) => SERVER.listen(0, '127.0.0.1', resolve));
  const address = SERVER.address();
  assert.ok(address && typeof address !== 'string');
  endpoint = `http://127.0.0.1:${address.port}`;
}

function reset() {
  process.env.WHISPER_BASE_URL = endpoint;
  delete process.env.WHISPER_LANGUAGE;
  delete process.env.WHISPER_TIMEOUT_MS;
  shutdown = new AbortController();
  received = Promise.withResolvers<FormData>();
  responseBody = JSON.stringify({ text: '  Привет, Пятница! \n' });
  status = 200;
  hang = 'none';
}

async function stopServer() {
  SERVER.closeAllConnections();
  await new Promise<void>((resolve) => SERVER.close(() => resolve()));
  for (const [key, value] of BEFORE_ENV) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function handleRequest(request: IncomingMessage, response: ServerResponse) {
  void respond(request, response).catch((error) => received.reject(error));
}

async function respond(request: IncomingMessage, response: ServerResponse) {
  assert.equal(request.method, 'POST');
  assert.equal(request.url, '/inference');
  RESPONSES.add(response);
  response.once('close', () => RESPONSES.delete(response));
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = Buffer.concat(chunks);
  const upload = new Request(endpoint, {
    method: 'POST',
    headers: request.headers as Record<string, string>,
    body,
  });
  const form = await upload.formData();
  received.resolve(form);
  if (hang === 'headers') return;
  response.writeHead(status, { 'content-type': 'application/json' });
  if (hang === 'body') {
    response.flushHeaders();
    return;
  }
  response.end(responseBody);
}

async function sendsAudio() {
  const text = await transcribe(WAV);
  assert.equal(text, 'Привет, Пятница!');
  const form = await received.promise;
  const file = form.get('file');
  assert.ok(file instanceof File);
  assert.equal(file.type, 'audio/wav');
  const uploaded = await file.arrayBuffer();
  const bytes = Buffer.from(uploaded);
  assert.deepEqual(bytes, WAV);
  assert.equal(form.get('language'), 'ru');
  assert.equal(form.get('temperature_inc'), '0');
  assert.equal(form.get('response_format'), 'json');
  assert.equal(form.get('no_context'), 'true');
}

async function acceptsSilence() {
  process.env.WHISPER_LANGUAGE = 'auto';
  responseBody = JSON.stringify({ text: '' });
  const text = await transcribe(WAV);
  assert.equal(text, '');
  const form = await received.promise;
  assert.equal(form.get('language'), 'auto');
}

async function rejectsBadResponses() {
  const cases = [
    { code: 503, body: '{}', error: /HTTP 503/ },
    {
      code: 200,
      body: '{"error":"failed to read audio data"}',
      error: /failed to read audio data/,
    },
    { code: 200, body: '{}', error: /missing text/ },
    { code: 200, body: '{"text":12}', error: /missing text/ },
    { code: 200, body: 'null', error: /Invalid Whisper response/ },
    { code: 200, body: 'not JSON', error: /JSON/ },
  ];
  for (const scenario of cases) {
    status = scenario.code;
    responseBody = scenario.body;
    const pending = transcribe(WAV);
    await assert.rejects(pending, scenario.error);
  }
}

async function boundsErrors() {
  const message = 'x'.repeat(20_000);
  responseBody = JSON.stringify({ error: message });
  const pending = transcribe(WAV);
  await assert.rejects(pending, isBoundedError);
}

function isBoundedError(error: unknown) {
  assert.ok(error instanceof Error);
  assert.ok(error.message.length < 8100);
  return true;
}

async function timesOut() {
  process.env.WHISPER_TIMEOUT_MS = '100';
  for (const stage of ['headers', 'body'] as const) {
    hang = stage;
    const pending = transcribe(WAV);
    await assert.rejects(pending, { name: 'TimeoutError' });
    await checkCleanup();
  }
}

async function cancels() {
  hang = 'headers';
  const pending = transcribe(WAV);
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  await received.promise;
  shutdown.abort();
  await rejected;
}

async function rejectsStopped() {
  shutdown.abort();
  const pending = transcribe(WAV);
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(RESPONSES.size, 0);
}

async function rejectsInvalidTimeout() {
  for (const timeout of ['0', '-1', 'NaN', '1.5', '2147483648']) {
    process.env.WHISPER_TIMEOUT_MS = timeout;
    const pending = transcribe(WAV);
    await assert.rejects(pending, /WHISPER_TIMEOUT_MS/);
  }
}

async function rejectsConnectionFailure() {
  process.env.WHISPER_BASE_URL = 'http://127.0.0.1:1';
  const pending = transcribe(WAV);
  await assert.rejects(pending, /fetch failed/);
}

async function checkCleanup() {
  const listeners = getEventListeners(shutdown.signal, 'abort');
  assert.equal(listeners.length, 0);
  for (let attempt = 0; attempt < 100 && RESPONSES.size > 0; attempt++) await delay(10);
  assert.equal(RESPONSES.size, 0, 'HTTP connections must close after cancellation');
}
