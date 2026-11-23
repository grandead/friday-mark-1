import { createTestDatabase } from './database.js';
import { version, v7 } from 'uuid';
import { deviceId, userId } from '../src/config/identity.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { buildApp } from '../src/app.js';
import { humidifierCommand } from '../src/services/smartHome/humidifier.js';

const start = { type: 'start', deviceId, userId, sampleRate: 20000, channels: 1, format: 's16le' };
async function fixture(t: test.TestContext, options: Partial<Parameters<typeof buildApp>[0]> = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'friday-server-'));
  const database = await createTestDatabase();
  const calls: string[] = [];
  const app = await buildApp({ db: database.db, recordingsDir: dir, transcribe: async path => { calls.push(path); return 'Привет'; }, log: () => {}, ...options });
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const ws = new WebSocket(address.replace('http:', 'ws:') + '/audio');
  const messages: any[] = [];
  ws.on('message', data => messages.push(JSON.parse(data.toString())));
  await once(ws, 'open');
  t.after(async () => { ws.terminate(); await app.close(); await database.close(); await rm(dir, { recursive: true, force: true }); });
  const until = async (predicate: () => boolean | Promise<boolean>) => {
    for (let i = 0; i < 200; i++) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
    throw new Error('Timed out');
  };
  return { app, dir, calls, ws, messages, until, db: database.db };
}

test('dispatches only complete humidifier commands', () => {
  assert.equal(humidifierCommand('Пятница, включи увлажнитель воздуха!'), 'on');
  assert.equal(humidifierCommand(' Выключи  увлажнитель. '), 'off');
  for (const text of ['Не включи увлажнитель', 'Он сказал: выключи увлажнитель', 'Включи увлажнитель и свет', '']) {
    assert.equal(humidifierCommand(text), undefined);
  }
});

test('command failure preserves the transcript and the next recording can control power', async t => {
  const logs: string[] = [];
  const commands: string[] = [];
  const spoken: string[] = [];
  const phrases = ['Включи увлажнитель.', 'Выключи увлажнитель.'];
  const { ws, messages, until, db } = await fixture(t, {
    transcribe: async () => phrases.shift()!,
    setHumidifierPower: async power => {
      commands.push(power);
      if (power === 'on') throw new Error('таймаут');
      return 'Увлажнитель выключен.';
    },
    synthesizeReply: async (text, output) => {
      spoken.push(text);
      assert.match(output, /\.reply\.wav$/);
    },
    log: message => logs.push(message),
  });
  for (let press = 1; press <= 2; press++) {
    ws.send(JSON.stringify(start));
    ws.send(Buffer.alloc(1024));
    ws.send(JSON.stringify({ type: 'end', samples: 512 }));
    await until(() => messages.filter(m => m.type === 'transcript').length === press);
  }
  await until(async () => await db.interaction.count({ where: { finishedAt: { not: null } } }) === 2);
  const journal = await db.interaction.findMany({ include: { actions: true }, orderBy: { startedAt: 'asc' } });
  assert.deepEqual(journal.map(row => row.status), ['failed', 'complete']);
  for (const row of journal) {
    assert.equal(version(row.id), 7);
    assert.equal(row.deviceId, deviceId);
    assert.equal(row.userId, userId);
    assert.equal(version(row.actions[0].id), 7);
  }
  assert.deepEqual(journal[1].actions[0].arguments, { power: 'off' });
  assert.deepEqual(journal[1].actions[0].result, { reply: 'Увлажнитель выключен.' });
  assert.match(journal[0].actions[0].error!, /таймаут/);
  assert.deepEqual(commands, ['on', 'off']);
  assert.deepEqual(spoken, ['Увлажнитель выключен.']);
  assert.ok(logs.some(message => message.startsWith('Голос Пятницы:')));
  assert.ok(logs.includes('Ошибка управления увлажнителем: таймаут'));
  assert.ok(logs.includes('Увлажнитель выключен.'));
  assert.ok(!messages.some(m => m.type === 'transcription_error'));
});

test('ordered PCM frames become a valid WAV and one transcript; next press is independent', async t => {
  const { dir, calls, ws, messages, until } = await fixture(t);
  const pcm = Buffer.alloc(4000);
  for (let i = 0; i < 2000; i++) pcm.writeInt16LE(i - 1000, i * 2);
  for (let press = 0; press < 2; press++) {
    ws.send(JSON.stringify({ ...start, sampleRate: press === 0 ? 20000 : 16000 }));
    ws.send(pcm.subarray(0, 1024)); ws.send(pcm.subarray(1024));
    ws.send(JSON.stringify({ type: 'end', samples: pcm.length / 2 }));
    await until(() => messages.filter(x => x.type === 'transcript').length === press + 1);
  }
  assert.equal(calls.length, 2);
  assert.equal((await readdir(dir)).length, 2);
  const wav = await readFile(calls[0]);
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.readUInt32LE(4), wav.length - 8);
  assert.equal(wav.readUInt32LE(24), 20000);
  assert.equal(wav.readUInt32LE(40), pcm.length);
  assert.deepEqual(wav.subarray(44), pcm);
  const next = await readFile(calls[1]);
  assert.equal(next.readUInt32LE(24), 16000);
  assert.deepEqual(next.subarray(44), pcm);
});

for (const ending of ['disconnect', 'abort', 'bad-count', 'unaligned'] as const) {
  test(`${ending}: keep incomplete WAV without transcription`, async t => {
    const { dir, calls, ws, messages, until } = await fixture(t);
    ws.send(JSON.stringify(start)); ws.send(Buffer.alloc(1024, 42));
    await until(() => messages.some(x => x.type === 'started'));
    if (ending === 'disconnect') ws.terminate();
    if (ending === 'abort') ws.send(JSON.stringify({ type: 'abort' }));
    if (ending === 'bad-count') ws.send(JSON.stringify({ type: 'end', samples: 999 }));
    if (ending === 'unaligned') ws.send(Buffer.alloc(3));
    await until(async () => (await readdir(dir)).some(x => x.endsWith('.incomplete.wav')));
    const files = await readdir(dir);
    assert.equal(files.length, 1);
    assert.equal(calls.length, 0);
    const wav = await readFile(join(dir, files[0]));
    assert.equal(wav.readUInt32LE(40), 1024);
  });
}

test('reject unsupported sample rate', async t => {
  const { ws, calls, messages, until } = await fixture(t);
  ws.send(JSON.stringify({ ...start, sampleRate: 44100 }));
  await until(() => messages.some(x => x.type === 'error'));
  assert.equal(calls.length, 0);
});


test('a rebooted device replaces a stale connection and can record immediately', async t => {
  const { dir, calls, ws, messages, until } = await fixture(t);
  ws.send(JSON.stringify(start)); ws.send(Buffer.alloc(1024));
  await until(() => messages.some(x => x.type === 'started'));
  const oldClosed = once(ws, 'close');
  const replacement = new WebSocket(ws.url);
  t.after(() => { replacement.terminate(); });
  const replies: any[] = [];
  replacement.on('message', data => replies.push(JSON.parse(data.toString())));
  await once(replacement, 'open');
  await oldClosed;
  replacement.send(JSON.stringify(start));
  replacement.send(Buffer.alloc(2048));
  replacement.send(JSON.stringify({ type: 'end', samples: 1024 }));
  await until(() => replies.some(x => x.type === 'transcript'));
  assert.equal(calls.length, 1);
  const files = await readdir(dir);
  assert.equal(files.filter(x => x.endsWith('.incomplete.wav')).length, 1);
  assert.equal(files.filter(x => x.endsWith('.wav')).length, 2);
});

for (const invalid of [{ userId: null }, { deviceId: null }, { userId: v7() }, { deviceId: v7() }]) {
  test(`rejects unregistered or missing identity: ${Object.keys(invalid)[0]} ${Object.values(invalid)[0]}`, async t => {
    const { ws, messages, until, db, dir } = await fixture(t);
    ws.send(JSON.stringify({ ...start, ...invalid }));
    await until(() => messages.some(m => m.type === 'error'));
    assert.equal(await db.interaction.count(), 0);
    assert.deepEqual(await readdir(dir), []);
  });
}

test('HTTP health tracks the same in-flight transcription as the audio socket', async t => {
  let failRecognition!: (reason: Error) => void;
  const { app, ws, messages, until, db } = await fixture(t, {
    recognizer: 'test-stt',
    transcribe: () => new Promise<string>((_, reject) => { failRecognition = reject; }),
  });
  const health = async () => (await app.inject({ url: '/health' })).json();
  assert.deepEqual(await health(), { ok: true, transcriptionJobs: 0, recognizer: 'test-stt' });
  ws.send(JSON.stringify(start));
  ws.send(Buffer.alloc(1024));
  ws.send(JSON.stringify({ type: 'end', samples: 512 }));
  await until(() => typeof failRecognition === 'function');
  try {
    assert.equal((await health()).transcriptionJobs, 1);
  } finally {
    failRecognition(new Error('recognizer unavailable'));
  }
  await until(() => messages.some(message => message.type === 'transcription_error'));
  assert.equal((await health()).transcriptionJobs, 0);
  const row = await db.interaction.findFirstOrThrow();
  assert.equal(row.status, 'failed');
  assert.match(row.inputAudioKey, /\.wav$/);
});
