import { createTestDatabase } from './database.js';
import { version, v7 } from 'uuid';
import { deviceId, userId } from '../src/config/identity.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { buildApp } from '../src/app.js';

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
  await until(async () => (await health()).transcriptionJobs === 0);
  const row = await db.interaction.findFirstOrThrow();
  assert.equal(row.status, 'failed');
  assert.match(row.inputAudioKey, /\.wav$/);
});

test('journal lists a device recording and serves its WAV by id with byte ranges', async t => {
  const { app, ws, messages, until, db } = await fixture(t);
  ws.send(JSON.stringify(start));
  ws.send(Buffer.alloc(1024));
  ws.send(JSON.stringify({ type: 'end', samples: 512 }));
  await until(async () => await db.interaction.count({ where: { status: 'complete' } }) === 1);

  const devices = (await app.inject('/api/devices')).json();
  assert.equal(devices[0].id, deviceId);
  const journal = await app.inject('/api/interactions?deviceId=' + deviceId);
  assert.equal(journal.statusCode, 200);
  const { items: [item], total } = journal.json();
  assert.equal(total, 1);
  const otherUser = await db.user.create({ data: { displayName: 'Test listener' } });
  const users = (await app.inject('/api/users')).json();
  assert.ok(users.some((user: { id: string }) => user.id === otherUser.id));
  const filtered = (await app.inject(`/api/interactions?deviceId=${deviceId}&userId=${otherUser.id}`)).json();
  assert.equal(filtered.total, 0);
  assert.deepEqual(filtered.items, []);
  assert.equal(item.id, messages.find(m => m.type === 'started').id);
  assert.equal(item.transcript, 'Привет');
  assert.equal(item.outputAudio, null);
  assert.equal(item.inputAudioKey, undefined);
  const audio = await app.inject({ url: item.inputAudio, headers: { range: 'bytes=0-43' } });
  assert.equal(audio.statusCode, 206);
  assert.equal(audio.rawPayload.length, 44);
  assert.equal(audio.rawPayload.toString('ascii', 0, 4), 'RIFF');
  assert.equal((await app.inject(`/api/interactions/${item.id}/audio/output`)).statusCode, 404);
  assert.equal((await app.inject('/api/interactions?deviceId=invalid')).statusCode, 400);
});

test('journal publishes completed and failed interactions, including replies without audio', async t => {
  const phrases = ['Привет', 'Включи увлажнитель', 'Выключи увлажнитель'];
  const { db, ws, until, messages, dir } = await fixture(t, {
    transcribe: async () => phrases.shift()!,
    generateReply: async (id, transcript) => {
      if (transcript === 'Привет') return '';
      const reply = transcript.startsWith('Включи') ? 'on' : 'off';
      await db.interactionAction.create({ data: { interactionId: id, sequence: 1, initiator: 'llm', service: 'smartHome', operation: 'set_device_power', arguments: { power: reply === 'on' }, result: { reply } } });
      return reply;
    },
    synthesizeReply: async (reply, output) => {
      if (reply === 'on') throw new Error('Synthesis failed');
      await copyFile(output.replace(/\.reply\.wav$/, '.wav'), output);
    },
  });
  const url = new URL('/api/journal/events', ws.url.replace('ws:', 'http:'));
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  assert.match(response.headers.get('content-type')!, /text\/event-stream/);
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
  try {
    assert.equal((await reader.read()).value, ': connected\n\n');
    for (let i = 1; i <= 3; i++) {
      ws.send(JSON.stringify(start));
      ws.send(Buffer.alloc(1024));
      ws.send(JSON.stringify({ type: 'end', samples: 512 }));
      await until(async () => await db.interaction.count({ where: { finishedAt: { not: null } } }) === i);
    }
    const id = messages.filter(m => m.type === 'started').at(-1).id;
    let event = '';
    while (!event.includes('\n\n')) {
      const chunk = await reader.read();
      assert.ok(!chunk.done);
      event += chunk.value;
    }
    while (event.split('\n\n').filter(Boolean).length < 3) {
      const chunk = await reader.read();
      assert.ok(!chunk.done);
      event += chunk.value;
    }
    const publishedEntries = event.trim().split('\n\n').map(frame => {
      const [name, payload] = frame.split('\n');
      assert.equal(name, 'event: interactionUpdated');
      return JSON.parse(payload.slice('data: '.length));
    });
    assert.deepEqual(publishedEntries.map(entry => entry.status), ['complete', 'failed', 'complete']);
    assert.equal(publishedEntries[0].outputAudio, null);
    assert.equal(publishedEntries[1].responseText, 'on');
    assert.match(publishedEntries[1].error, /Synthesis failed/);
    const published = publishedEntries[2];
    assert.equal(published.id, id);
    assert.equal(published.device.id, deviceId);
    assert.equal(published.user.id, userId);
    assert.equal(published.status, 'complete');
    assert.equal(published.responseText, 'off');
    assert.equal(published.actions[0].operation, 'set_device_power');
    assert.deepEqual(published.actions[0].result, { reply: 'off' });
    assert.equal(published.outputAudio, `/api/interactions/${id}/audio/output`);
    assert.equal(published.inputAudioKey, undefined);
    const entry = await db.interaction.findUniqueOrThrow({ where: { id } });
    assert.equal(entry.status, 'complete');
    assert.equal((await readFile(join(dir, entry.outputAudioKey!))).toString('ascii', 0, 4), 'RIFF');
  } finally {
    await reader.cancel();
  }
});


test('journal cursors keep a stable history across inserts and combine device, user and time filters', async t => {
  const { app, db } = await fixture(t);
  const otherDevice = await db.device.create({ data: { displayName: 'Second device' } });
  const otherUser = await db.user.create({ data: { displayName: 'Second user' } });
  const startedAt = new Date('2026-11-23T10:00:00.000Z');
  const rows = Array.from({ length: 32 }, (_, index) => ({
    id: v7(), deviceId, userId, startedAt, status: 'complete', inputAudioKey: `history-${index}.wav`,
  }));
  await db.interaction.createMany({ data: rows });
  await db.interaction.create({ data: {
    deviceId: otherDevice.id, userId: otherUser.id, startedAt,
    status: 'complete', inputAudioKey: 'second-device.wav',
  } });
  const query = new URLSearchParams({ deviceId, userId, from: startedAt.toISOString(), to: startedAt.toISOString() });
  const first = (await app.inject(`/api/interactions?${query}`)).json();
  assert.equal(first.items.length, 15);
  assert.equal(first.total, 32);
  assert.ok(first.items.every((entry: any) => entry.device.id === deviceId && entry.user.id === userId));
  await db.interaction.create({ data: {
    deviceId, userId, status: 'complete', inputAudioKey: 'new.wav',
    startedAt,
  } });
  const ids = first.items.map((entry: any) => entry.id);
  let cursor = first.nextCursor;
  while (cursor) {
    query.set('before', cursor.startedAt);
    query.set('beforeId', cursor.id);
    const page = (await app.inject(`/api/interactions?${query}`)).json();
    ids.push(...page.items.map((entry: any) => entry.id));
    cursor = page.nextCursor;
  }
  assert.deepEqual(ids, rows.map(row => row.id).sort().reverse());
  const all = (await app.inject('/api/interactions')).json();
  assert.equal(all.total, 34);
  const acrossDevices = (await app.inject(`/api/interactions?userId=${otherUser.id}`)).json();
  assert.equal(acrossDevices.items[0].device.displayName, 'Second device');
  const empty = (await app.inject('/api/interactions?from=2027-01-01T00:00:00Z')).json();
  assert.deepEqual(empty.items, []);
  for (const invalid of [
    'from=invalid', 'from=2026-11-24T00:00:00Z&to=2026-11-23T00:00:00Z',
    `beforeId=${rows[0].id}`, 'before=2026-11-23T10:00:00Z',
  ]) assert.equal((await app.inject(`/api/interactions?${invalid}`)).statusCode, 400);
});


test('LLM replies survive TTS failure, model failures do not block the queue, and blank speech is skipped', async t => {
  const phrases = ['Первый вопрос', 'Второй вопрос', 'Третий вопрос', '   '];
  const generated: string[] = [];
  const spoken: string[] = [];
  const { ws, messages, until, db } = await fixture(t, {
    transcribe: async () => phrases.shift()!,
    generateReply: async (id, text) => {
      assert.equal((await db.interaction.findUniqueOrThrow({ where: { id } })).transcript, text);
      generated.push(text);
      if (text === 'Второй вопрос') throw new Error('Model unavailable');
      return 'Ответ на ' + text;
    },
    synthesizeReply: async (text, output) => {
      spoken.push(text);
      if (text.endsWith('Первый вопрос')) throw new Error('TTS unavailable');
      await copyFile(output.replace(/\.reply\.wav$/, '.wav'), output);
    },
  });
  for (let count = 1; count <= 4; count++) {
    ws.send(JSON.stringify(start));
    ws.send(Buffer.alloc(1024));
    ws.send(JSON.stringify({ type: 'end', samples: 512 }));
    await until(async () => await db.interaction.count({ where: { finishedAt: { not: null } } }) === count);
  }
  const rows = await db.interaction.findMany({ orderBy: [{ startedAt: 'asc' }, { id: 'asc' }] });
  assert.deepEqual(rows.map(row => row.status), ['failed', 'failed', 'complete', 'complete']);
  assert.equal(rows[0].responseText, 'Ответ на Первый вопрос');
  assert.equal(rows[0].responseSource, 'llm');
  assert.equal(rows[0].outputAudioKey, null);
  assert.match(rows[1].error!, /Model unavailable/);
  assert.equal(rows[2].responseSource, 'llm');
  assert.ok(rows[2].outputAudioKey);
  assert.equal(rows[3].responseText, null);
  assert.equal(generated.length, 3);
  assert.equal(spoken.length, 2);
  assert.ok(messages.some(message => message.type === 'processing_error'));
  assert.ok(!messages.some(message => message.type === 'transcription_error'));
});
