import assert from 'node:assert/strict';
import { once } from 'node:events';
import { copyFile, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { v7 } from 'uuid';
import { WebSocket } from 'ws';
import type { serializeInteractionPage } from '../src/app/api/interactions/_lib/serialize-interaction-page';
import { DEVICE_ID as deviceId, USER_ID as userId } from '../src/config/identity';
import { buildApp } from './application';
import { createTestDatabase } from './database';

const { getPendingInteractionCount } = await import('../src/services/interactions');

type AudioReply = { type: string; id?: string; code?: string; message?: string };
type InteractionPage = Awaited<ReturnType<typeof serializeInteractionPage>>;
const start = { type: 'start', deviceId, userId, sampleRate: 20000, channels: 1, format: 's16le' };
async function fixture(t: test.TestContext, options: Partial<Parameters<typeof buildApp>[0]> = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'friday-server-'));
  const database = await createTestDatabase();
  const calls: Buffer[] = [];
  const app = await buildApp({
    db: database.db,
    recordingsDir: dir,
    transcribe: async (wav) => {
      const bytes = Buffer.from(wav);
      calls.push(bytes);
      return 'Привет';
    },
    ...options,
  });
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const ws = new WebSocket(`${address.replace('http:', 'ws:')}/audio`);
  const messages: AudioReply[] = [];
  ws.on('message', (data) => messages.push(JSON.parse(data.toString())));
  await once(ws, 'open');
  t.after(async () => {
    ws.terminate();
    await app.close();
    await database.close();
    await rm(dir, { recursive: true, force: true });
  });
  const until = async (predicate: () => boolean | Promise<boolean>) => {
    for (let i = 0; i < 200; i++) {
      if (await predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('Timed out');
  };
  return { app, dir, calls, ws, messages, until, db: database.db };
}

test('ordered PCM frames become a valid WAV and one transcript; next press is independent', async (t) => {
  const { dir, calls, ws, messages, until } = await fixture(t);
  const pcm = Buffer.alloc(4000);
  for (let i = 0; i < 2000; i++) pcm.writeInt16LE(i - 1000, i * 2);
  for (let press = 0; press < 2; press++) {
    ws.send(JSON.stringify({ ...start, sampleRate: press === 0 ? 20000 : 16000 }));
    ws.send(pcm.subarray(0, 1024));
    ws.send(pcm.subarray(1024));
    ws.send(JSON.stringify({ type: 'end', samples: pcm.length / 2 }));
    await until(() => messages.filter((x) => x.type === 'transcript').length === press + 1);
  }
  assert.equal(calls.length, 2);
  assert.equal((await readdir(dir)).length, 4);
  const wav = calls[0];
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.readUInt32LE(4), wav.length - 8);
  assert.equal(wav.readUInt32LE(24), 20000);
  assert.equal(wav.readUInt32LE(40), pcm.length);
  assert.deepEqual(wav.subarray(44), pcm);
  const next = calls[1];
  assert.equal(next.readUInt32LE(24), 16000);
  assert.deepEqual(next.subarray(44), pcm);
});

for (const ending of ['disconnect', 'abort', 'bad-count', 'unaligned'] as const) {
  test(`${ending}: keep incomplete WAV without transcription`, async (t) => {
    const { app, dir, calls, ws, messages, until } = await fixture(t);
    ws.send(JSON.stringify(start));
    ws.send(Buffer.alloc(1024, 42));
    await until(() => messages.some((x) => x.type === 'started'));
    if (ending === 'disconnect') ws.terminate();
    if (ending === 'abort') ws.send(JSON.stringify({ type: 'abort' }));
    if (ending === 'bad-count') ws.send(JSON.stringify({ type: 'end', samples: 999 }));
    if (ending === 'unaligned') ws.send(Buffer.alloc(3));
    await until(async () => (await readdir(dir)).some((x) => x.endsWith('.incomplete.wav')));
    await until(async () => {
      const response = await app.inject('/api/interactions');
      return response.json().items[0]?.status === 'incomplete';
    });
    const files = await readdir(dir);
    assert.equal(files.length, 1);
    assert.equal(calls.length, 0);
    const wav = await readFile(join(dir, files[0]));
    assert.equal(wav.readUInt32LE(40), 1024);
  });
}

test('an aborted recording updates the live journal before reconnect', async (t) => {
  const { ws, messages, until } = await fixture(t);
  const url = new URL('/api/interactions/live', ws.url.replace('ws:', 'http:'));
  const signal = AbortSignal.timeout(5000);
  const response = await fetch(url, { signal });
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
  try {
    await reader.read();
    ws.send(JSON.stringify(start));
    await until(() => messages.some((message) => message.type === 'started'));
    ws.send(JSON.stringify({ type: 'abort' }));
    let events = '';
    while (!events.includes('"status":"incomplete"')) {
      const chunk = await reader.read();
      assert.ok(!chunk.done);
      events += chunk.value;
    }
    assert.match(events, /"code":"recording_interrupted"/);
    assert.doesNotMatch(events, /ESP32 reported lost samples/);
  } finally {
    await reader.cancel();
  }
});

test('reject unsupported sample rate', async (t) => {
  const { ws, calls, messages, until } = await fixture(t);
  ws.send(JSON.stringify({ ...start, sampleRate: 44100 }));
  await until(() => messages.some((x) => x.type === 'error'));
  assert.equal(calls.length, 0);
});

test('a rebooted device replaces a stale connection and can record immediately', async (t) => {
  const { dir, calls, ws, messages, until } = await fixture(t);
  ws.send(JSON.stringify(start));
  ws.send(Buffer.alloc(1024));
  await until(() => messages.some((x) => x.type === 'started'));
  const oldClosed = once(ws, 'close');
  const replacement = new WebSocket(ws.url);
  t.after(() => {
    replacement.terminate();
  });
  const replies: AudioReply[] = [];
  replacement.on('message', (data) => replies.push(JSON.parse(data.toString())));
  await once(replacement, 'open');
  await oldClosed;
  replacement.send(JSON.stringify(start));
  replacement.send(Buffer.alloc(2048));
  replacement.send(JSON.stringify({ type: 'end', samples: 1024 }));
  await until(() => replies.some((x) => x.type === 'transcript'));
  assert.equal(calls.length, 1);
  const files = await readdir(dir);
  assert.equal(files.filter((x) => x.endsWith('.incomplete.wav')).length, 1);
  assert.equal(files.filter((x) => x.endsWith('.wav')).length, 2);
});

for (const invalid of [
  { userId: null },
  { deviceId: null },
  { userId: v7() },
  { deviceId: v7() },
]) {
  test(`rejects unregistered or missing identity: ${Object.keys(invalid)[0]} ${Object.values(invalid)[0]}`, async (t) => {
    const { ws, messages, until, db, dir } = await fixture(t);
    ws.send(JSON.stringify({ ...start, ...invalid }));
    await until(() => messages.some((m) => m.type === 'error'));
    assert.equal(
      await db.orm.public.Interaction.aggregate((a) => ({ count: a.count() })).then((r) => r.count),
      0,
    );
    assert.deepEqual(await readdir(dir), []);
  });
}

test('HTTP health stays a plain 200 response while an interaction is processing', async (t) => {
  let failRecognition!: (reason: Error) => void;
  const { app, ws, messages, until, db } = await fixture(t, {
    transcribe: () =>
      new Promise<string>((_, reject) => {
        failRecognition = reject;
      }),
  });
  const initialHealth = await app.inject('/api/health');
  assert.equal(initialHealth.statusCode, 200);
  assert.equal(initialHealth.body, '');
  ws.send(JSON.stringify(start));
  ws.send(Buffer.alloc(1024));
  ws.send(JSON.stringify({ type: 'end', samples: 512 }));
  await until(() => typeof failRecognition === 'function');
  try {
    const pendingInteractions = getPendingInteractionCount();
    assert.equal(pendingInteractions, 1);
    const busyHealth = await app.inject('/api/health');
    assert.equal(busyHealth.statusCode, 200);
    assert.equal(busyHealth.body, '');
  } finally {
    failRecognition(new Error('recognizer unavailable'));
  }
  await until(() => messages.some((message) => message.type === 'transcription_error'));
  const failure = messages.find((message) => message.type === 'transcription_error');
  assert.ok(failure);
  assert.equal(failure.code, 'internal_error');
  assert.equal(failure.message, 'An internal error occurred.');
  await until(() => getPendingInteractionCount() === 0);
  const row = await db.orm.public.Interaction.firstOrThrow();
  assert.equal(row.status, 'failed');
  assert.match(row.inputAudioKey, /\.wav$/);
});

test('journal lists a device recording and serves its WAV by id with byte ranges', async (t) => {
  const { app, ws, messages, until, db } = await fixture(t);
  ws.send(JSON.stringify(start));
  ws.send(Buffer.alloc(1024));
  ws.send(JSON.stringify({ type: 'end', samples: 512 }));
  await until(
    async () =>
      (await db.orm.public.Interaction.where({ status: 'complete' })
        .aggregate((a) => ({ count: a.count() }))
        .then((r) => r.count)) === 1,
  );

  const devices = (await app.inject('/api/devices')).json();
  assert.equal(devices[0].id, deviceId);
  const journal = await app.inject(`/api/interactions?deviceId=${deviceId}`);
  assert.equal(journal.statusCode, 200);
  const result = journal.json<InteractionPage>();
  assert.equal(result.items.length, 1);
  assert.equal(result.nextCursor, null);
  const [item] = result.items;
  const otherUser = await db.orm.public.User.create({ displayName: 'Test listener' });
  const users = (await app.inject('/api/users')).json();
  assert.ok(users.some((user: { id: string }) => user.id === otherUser.id));
  const filtered = (
    await app.inject(`/api/interactions?deviceId=${deviceId}&userId=${otherUser.id}`)
  ).json();
  assert.deepEqual(filtered.items, []);
  assert.equal(filtered.nextCursor, null);
  assert.equal(item.id, messages.find((m) => m.type === 'started')!.id);
  assert.equal(item.transcript, 'Привет');
  assert.equal(item.hasOutputAudio, false);
  assert.equal('inputAudioKey' in item, false);
  assert.equal('outputAudioKey' in item, false);
  assert.equal('inputAudio' in item, false);
  assert.equal('outputAudio' in item, false);
  assert.equal(item.hasInputAudio, true);
  const inputAudioUrl = `/api/audio/${item.id}/input`;
  const completeAudio = await app.inject(inputAudioUrl);
  assert.equal(completeAudio.statusCode, 200);
  assert.equal(completeAudio.headers['content-type'], 'audio/wav');
  const audio = await app.inject({ url: inputAudioUrl, headers: { range: 'bytes=0-43' } });
  assert.equal(audio.statusCode, 206);
  assert.equal(audio.rawPayload.length, 44);
  assert.equal(audio.rawPayload.toString('ascii', 0, 4), 'RIFF');
  const suffix = await app.inject({ url: inputAudioUrl, headers: { range: 'bytes=-4' } });
  const expectedSuffix = completeAudio.rawPayload.subarray(-4);
  assert.equal(suffix.statusCode, 206);
  assert.deepEqual(suffix.rawPayload, expectedSuffix);
  const invalidRange = await app.inject({
    url: inputAudioUrl,
    headers: { range: `bytes=${completeAudio.rawPayload.length}-` },
  });
  assert.equal(invalidRange.statusCode, 416);
  const missingOutput = await app.inject(`/api/audio/${item.id}/output`);
  assert.equal(missingOutput.statusCode, 404);
  const invalidId = await app.inject('/api/audio/invalid/input');
  assert.equal(invalidId.statusCode, 400);
  const invalidKind = await app.inject(`/api/audio/${item.id}/unknown`);
  assert.equal(invalidKind.statusCode, 400);
  assert.equal((await app.inject('/api/interactions?deviceId=invalid')).statusCode, 400);
});

test('journal publishes completed and failed interactions, including replies without audio', async (t) => {
  const phrases = ['Привет', 'Включи увлажнитель', 'Выключи увлажнитель'];
  const { app, db, ws, until, messages, dir } = await fixture(t, {
    transcribe: async () => phrases.shift()!,
    generateReply: async (id, transcript) => {
      if (transcript === 'Привет') return '';
      const reply = transcript.startsWith('Включи') ? 'on' : 'off';
      await db.orm.public.InteractionAction.create({
        interactionId: id,
        sequence: 1,
        initiator: 'llm',
        service: 'smartHome',
        operation: 'set_device_power',
        arguments: { power: reply === 'on' },
        result: { reply },
      });
      return reply;
    },
    synthesizeSpeech: async (reply, output) => {
      if (reply === 'on') throw new Error('Synthesis failed');
      await copyFile(output.replace(/\.reply\.wav$/, '.wav'), output);
    },
  });
  const url = new URL('/api/interactions/live', ws.url.replace('ws:', 'http:'));
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  assert.match(response.headers.get('content-type')!, /text\/event-stream/);
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
  try {
    assert.equal((await reader.read()).value, ': connected\n\n');
    for (let i = 1; i <= 3; i++) {
      ws.send(JSON.stringify(start));
      ws.send(Buffer.alloc(1024));
      ws.send(JSON.stringify({ type: 'end', samples: 512 }));
      await until(
        async () =>
          (await db.orm.public.Interaction.where((r) => r.finishedAt.isNotNull())
            .aggregate((a) => ({ count: a.count() }))
            .then((r) => r.count)) === i,
      );
    }
    const id = messages.filter((m) => m.type === 'started').at(-1)!.id;
    const terminalEntries = new Map<string, InteractionPage['items'][number]>();
    let buffered = '';
    while (terminalEntries.size < 3) {
      const chunk = await reader.read();
      assert.ok(!chunk.done);
      buffered += chunk.value;
      const frames = buffered.split('\n\n');
      buffered = frames.pop() ?? '';
      for (const frame of frames) {
        const [name, payload] = frame.split('\n');
        assert.equal(name, 'event: interaction.updated');
        const entry = JSON.parse(payload.slice('data: '.length));
        if (entry.status === 'complete' || entry.status === 'failed')
          terminalEntries.set(entry.id, entry);
      }
    }
    const publishedEntries = [...terminalEntries.values()];
    assert.deepEqual(
      publishedEntries.map((entry) => entry.status),
      ['complete', 'failed', 'complete'],
    );
    assert.equal(publishedEntries[0].hasOutputAudio, false);
    assert.equal(publishedEntries[1].responseText, 'on');
    assert.equal(publishedEntries[1].error?.code, 'internal_error');
    assert.doesNotMatch(JSON.stringify(publishedEntries), /Synthesis failed/);
    const published = publishedEntries[2];
    assert.equal(published.id, id);
    assert.equal(published.device.id, deviceId);
    assert.equal(published.user.id, userId);
    assert.equal(published.status, 'complete');
    assert.equal(published.responseText, 'off');
    assert.equal(published.actions[0].operation, 'set_device_power');
    assert.deepEqual(published.actions[0].result, { reply: 'off' });
    assert.equal(published.hasOutputAudio, true);
    assert.equal('inputAudio' in published, false);
    assert.equal('outputAudio' in published, false);
    assert.equal('inputAudioKey' in published, false);
    assert.equal('outputAudioKey' in published, false);
    const pageResponse = await app.inject('/api/interactions');
    const page = pageResponse.json<InteractionPage>();
    const pageEntry = page.items.find((item) => item.id === id);
    assert.deepEqual(published, pageEntry);
    const entry = await db.orm.public.Interaction.firstOrThrow({ id });
    assert.equal(entry.status, 'complete');
    assert.equal(
      (await readFile(join(dir, entry.outputAudioKey!))).toString('ascii', 0, 4),
      'RIFF',
    );
  } finally {
    await reader.cancel();
  }
});

test('journal cursors keep a stable history across inserts and combine device, user and time filters', async (t) => {
  const { app, db } = await fixture(t);
  const otherDevice = await db.orm.public.Device.create({ displayName: 'Second device' });
  const otherUser = await db.orm.public.User.create({ displayName: 'Second user' });
  const startedAt = new Date('2026-11-23T10:00:00.000Z');
  const rows = Array.from({ length: 32 }, (_, index) => ({
    id: v7(),
    deviceId,
    userId,
    startedAt,
    status: 'complete',
    inputAudioKey: `history-${index}.wav`,
  }));
  for (const row of rows) await db.orm.public.Interaction.create(row);
  await db.orm.public.Interaction.create({
    deviceId: otherDevice.id,
    userId: otherUser.id,
    startedAt,
    status: 'complete',
    inputAudioKey: 'second-device.wav',
  });
  const query = new URLSearchParams({
    deviceId,
    userId,
    from: startedAt.toISOString(),
    to: startedAt.toISOString(),
  });
  const first = (await app.inject(`/api/interactions?${query}`)).json<InteractionPage>();
  assert.equal(first.items.length, 15);
  const responseKeys = Object.keys(first);
  responseKeys.sort();
  assert.deepEqual(responseKeys, ['items', 'nextCursor']);
  assert.ok(first.nextCursor);
  assert.ok(first.items.every((entry) => entry.device.id === deviceId && entry.user.id === userId));
  await db.orm.public.Interaction.create({
    deviceId,
    userId,
    status: 'complete',
    inputAudioKey: 'new.wav',
    startedAt,
  });
  const ids = first.items.map((entry) => entry.id);
  let cursor: InteractionPage['nextCursor'] = first.nextCursor;
  while (cursor) {
    query.set('before', cursor.startedAt);
    query.set('beforeId', cursor.id);
    const page = (await app.inject(`/api/interactions?${query}`)).json<InteractionPage>();
    ids.push(...page.items.map((entry) => entry.id));
    cursor = page.nextCursor;
  }
  assert.deepEqual(
    ids,
    rows
      .map((row) => row.id)
      .sort()
      .reverse(),
  );
  const all = (await app.inject('/api/interactions')).json();
  assert.equal(all.items.length, 15);
  assert.ok(all.nextCursor);
  const acrossDevices = (await app.inject(`/api/interactions?userId=${otherUser.id}`)).json();
  assert.equal(acrossDevices.items[0].device.displayName, 'Second device');
  const empty = (await app.inject('/api/interactions?from=2027-01-01T00:00:00Z')).json();
  assert.deepEqual(empty.items, []);
  assert.equal(empty.nextCursor, null);
  for (const invalid of [
    'from=invalid',
    'from=2026-11-24T00:00:00Z&to=2026-11-23T00:00:00Z',
    `beforeId=${rows[0].id}`,
    'before=2026-11-23T10:00:00Z',
  ])
    assert.equal((await app.inject(`/api/interactions?${invalid}`)).statusCode, 400);
});

test('LLM replies survive TTS failure, model failures do not block the queue, and blank speech is skipped', async (t) => {
  const phrases = ['Первый вопрос', 'Второй вопрос', 'Третий вопрос', '   '];
  const generated: string[] = [];
  const spoken: string[] = [];
  const { ws, messages, until, db } = await fixture(t, {
    transcribe: async () => phrases.shift()!,
    generateReply: async (id, text) => {
      assert.equal((await db.orm.public.Interaction.firstOrThrow({ id })).transcript, text);
      generated.push(text);
      if (text === 'Второй вопрос') throw new Error('Model unavailable');
      return `Ответ на ${text}`;
    },
    synthesizeSpeech: async (text, output) => {
      spoken.push(text);
      if (text.endsWith('Первый вопрос')) throw new Error('TTS unavailable');
      await copyFile(output.replace(/\.reply\.wav$/, '.wav'), output);
    },
  });
  for (let count = 1; count <= 4; count++) {
    ws.send(JSON.stringify(start));
    ws.send(Buffer.alloc(1024));
    ws.send(JSON.stringify({ type: 'end', samples: 512 }));
    await until(
      async () =>
        (await db.orm.public.Interaction.where((r) => r.finishedAt.isNotNull())
          .aggregate((a) => ({ count: a.count() }))
          .then((r) => r.count)) === count,
    );
  }
  const rows = await db.orm.public.Interaction.orderBy([
    (r) => r.startedAt.asc(),
    (r) => r.id.asc(),
  ]).all();
  assert.deepEqual(
    rows.map((row) => row.status),
    ['failed', 'failed', 'complete', 'complete'],
  );
  assert.equal(rows[0].responseText, 'Ответ на Первый вопрос');
  assert.equal(rows[0].responseSource, 'llm');
  assert.equal(rows[0].outputAudioKey, null);
  assert.match(rows[1].error!, /Model unavailable/);
  assert.equal(rows[2].responseSource, 'llm');
  assert.ok(rows[2].outputAudioKey);
  assert.equal(rows[3].responseText, null);
  assert.equal(generated.length, 3);
  assert.equal(spoken.length, 2);
  assert.ok(messages.some((message) => message.type === 'processing_error'));
  assert.ok(!messages.some((message) => message.type === 'transcription_error'));
});
