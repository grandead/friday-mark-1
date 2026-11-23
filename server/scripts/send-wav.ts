import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { WebSocket } from 'ws';

export async function sendWav(path: string, url: string): Promise<string> {
  const wav = await readFile(path);
  if (wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Expected WAV');
  let pcm: Buffer | undefined;
  let sampleRate = 0;
  let formatOk = false;
  for (let at = 12; at + 8 <= wav.length;) {
    const name = wav.toString('ascii', at, at + 4), size = wav.readUInt32LE(at + 4);
    if (at + 8 + size > wav.length) throw new Error('Truncated WAV');
    if (name === 'fmt ' && size >= 16) {
      sampleRate = wav.readUInt32LE(at + 12);
      formatOk = wav.readUInt16LE(at + 8) === 1 && wav.readUInt16LE(at + 10) === 1 &&
        [16000, 20000].includes(sampleRate) && wav.readUInt16LE(at + 22) === 16;
    }
    if (name === 'data') pcm = wav.subarray(at + 8, at + 8 + size);
    at += 8 + size + (size % 2);
  }
  if (!formatOk || !pcm?.length) throw new Error('Expected nonempty PCM16 mono 16000 or 20000 Hz WAV');
  const socket = new WebSocket(url);
  let completed = false;
  let timeout: NodeJS.Timeout;
  const result = new Promise<string>((resolve, reject) => {
    timeout = setTimeout(() => reject(new Error('Transcription timed out')), 360_000);
    socket.on('error', reject);
    socket.on('close', () => { if (!completed) reject(new Error('Server disconnected')); });
    socket.on('message', raw => {
      const message = JSON.parse(raw.toString());
      if (message.type === 'transcript') { completed = true; resolve(message.text); }
      if (message.type === 'error' || message.type === 'transcription_error') reject(new Error(message.message));
    });
  });
  // Attach rejection handling immediately, including while audio is still sending.
  void result.catch(() => {});
  try {
    await once(socket, 'open');
    socket.send(JSON.stringify({ type: 'start', sampleRate, channels: 1, format: 's16le' }));
    for (let at = 0; at < pcm.length; at += 1024) {
      if (socket.readyState !== WebSocket.OPEN) throw new Error('Disconnected during recording');
      const frame = pcm.subarray(at, at + 1024);
      socket.send(frame);
      await delay(frame.length * 1000 / (2 * sampleRate));
    }
    socket.send(JSON.stringify({ type: 'end', samples: pcm.length / 2 }));
    return await result;
  } finally { clearTimeout(timeout!); socket.terminate(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2]) throw new Error('Usage: npm run send:wav -- /absolute/file.wav [ws://localhost:3000/audio]');
  console.log(await sendWav(process.argv[2], process.argv[3] ?? 'ws://127.0.0.1:3000/audio'));
}
