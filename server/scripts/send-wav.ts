import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { WebSocket } from 'ws';
import { DEVICE_ID as deviceId, USER_ID as userId } from '../src/config/identity';
import { serverPort } from '../src/config/port';

export async function sendWav(path: string, url: string): Promise<string> {
  const wav = await readFile(path);
  if (wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE')
    throw new Error('Expected WAV');
  let pcm: Buffer | undefined;
  let sampleRate = 0;
  let formatOk = false;
  for (let at = 12; at + 8 <= wav.length; ) {
    const name = wav.toString('ascii', at, at + 4),
      size = wav.readUInt32LE(at + 4);
    if (at + 8 + size > wav.length) throw new Error('Truncated WAV');
    if (name === 'fmt ' && size >= 16) {
      sampleRate = wav.readUInt32LE(at + 12);
      formatOk =
        wav.readUInt16LE(at + 8) === 1 &&
        wav.readUInt16LE(at + 10) === 1 &&
        [16000, 20000].includes(sampleRate) &&
        wav.readUInt16LE(at + 22) === 16;
    }
    if (name === 'data') pcm = wav.subarray(at + 8, at + 8 + size);
    at += 8 + size + (size % 2);
  }
  if (!formatOk || !pcm?.length)
    throw new Error('Expected nonempty PCM16 mono 16000 or 20000 Hz WAV');
  const socket = new WebSocket(url);
  const reply = Promise.withResolvers<string>();
  const timeout = setTimeout(() => reply.reject(new Error('Transcription timed out')), 360_000);
  socket.on('error', reply.reject);
  socket.on('close', () => reply.reject(new Error('Server disconnected')));
  socket.on('message', (raw) => receiveReply(raw, reply));
  const result = reply.promise;
  // Attach rejection handling immediately, including while audio is still sending.
  void result.catch(() => {});
  try {
    await once(socket, 'open');
    const start = JSON.stringify({
      type: 'start',
      deviceId,
      userId,
      sampleRate,
      channels: 1,
      format: 's16le',
    });
    socket.send(start);
    for (let at = 0; at < pcm.length; at += 1024) {
      if (socket.readyState !== WebSocket.OPEN) throw new Error('Disconnected during recording');
      const frame = pcm.subarray(at, at + 1024);
      socket.send(frame);
      await delay((frame.length * 1000) / (2 * sampleRate));
    }
    const end = JSON.stringify({ type: 'end', samples: pcm.length / 2 });
    socket.send(end);
    return await result;
  } finally {
    clearTimeout(timeout);
    socket.terminate();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2])
    throw new Error(
      `Usage: npm run send:wav -- /absolute/file.wav [ws://localhost:${serverPort}/audio]`,
    );
  const url = process.argv[3] ?? `ws://127.0.0.1:${serverPort}/audio`;
  const text = await sendWav(process.argv[2], url);
  console.log(text);
}

function receiveReply(raw: import('ws').RawData, reply: PromiseWithResolvers<string>) {
  const text = raw.toString();
  const message = JSON.parse(text);
  if (message.type === 'transcript') reply.resolve(message.text);
  if (message.type === 'error' || message.type === 'transcription_error') {
    const error = new Error(message.message);
    reply.reject(error);
  }
}
