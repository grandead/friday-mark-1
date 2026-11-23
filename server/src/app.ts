import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Recording } from './audio.js';
import { humidifierCommand } from './humidifier.js';
import type { WebSocket } from 'ws';

type Options = {
  recordingsDir: string;
  recognizer?: string;
  transcribe: (path: string) => Promise<string>;
  setHumidifierPower?: (power: 'on' | 'off') => Promise<string>;
  synthesizeReply?: (text: string, output: string) => Promise<void>;
  log?: (message: string) => void;
};

export async function buildApp(options: Options) {
  const log = options.log ?? console.log;
  const app = Fastify({ logger: false });
  mkdirSync(options.recordingsDir, { recursive: true });
  await app.register(websocket, { options: { maxPayload: 8192, perMessageDeflate: false } });
  let currentSocket: WebSocket | undefined;
  let jobs = 0;
  let inference = Promise.resolve();
  app.addHook('onClose', async () => { await inference; });
  app.get('/health', async () => ({ ok: true, transcriptionJobs: jobs, recognizer: options.recognizer }));
  app.get('/audio', { websocket: true }, (socket) => {
    // A rebooted ESP32 cannot close its previous TCP connection. Replace it
    // immediately instead of rejecting the new socket until TCP times out.
    currentSocket?.terminate();
    currentSocket = socket;
    log('ESP32 подключён. Жду «Пятница» или касание.');
    let recording: Recording | undefined;
    let idle: NodeJS.Timeout | undefined;
    let deadline: NodeJS.Timeout | undefined;
    let failed = false;
    const send = (value: unknown) => { if (socket.readyState === 1) socket.send(JSON.stringify(value)); };
    const clearTimers = () => { clearTimeout(idle); clearTimeout(deadline); };
    const abort = (reason: string) => {
      clearTimers();
      const previous = recording; recording = undefined;
      if (previous) {
        try { log(`Неполная запись: ${previous.finish(false)} (${reason})`); }
        catch (error) { log(`Ошибка сохранения неполной записи: ${error}`); }
      }
    };
    const fail = (reason: string) => {
      if (failed) return;
      failed = true;
      abort(reason); send({ type: 'error', message: reason }); socket.close(1008, reason.slice(0, 100));
    };
    const touch = () => {
      clearTimeout(idle);
      idle = setTimeout(() => fail('Audio idle timeout'), 10_000);
    };
    socket.on('message', (raw, binary) => {
      if (failed) return;
      try {
        const data = Buffer.isBuffer(raw) ? raw : Buffer.concat(Array.isArray(raw) ? raw : [Buffer.from(raw)]);
        if (binary) {
          if (!recording) throw new Error('Audio without start');
          recording.append(data); touch(); return;
        }
        const message = JSON.parse(data.toString('utf8'));
        if (message.type === 'start') {
          if (recording) throw new Error('Duplicate start');
          if (jobs >= 4) throw new Error('Transcription queue full');
          if (![16000, 20000].includes(message.sampleRate) || message.channels !== 1 || message.format !== 's16le') {
            throw new Error('Expected mono s16le at 16000 or 20000 Hz');
          }
          const id = new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8);
          recording = new Recording(join(options.recordingsDir, id), message.sampleRate);
          touch(); deadline = setTimeout(() => fail('Recording time limit'), 125_000);
          log(`● RECORD ${id}`);
          send({ type: 'started', id });
        } else if (message.type === 'end') {
          if (!recording) throw new Error('End without start');
          if (!Number.isSafeInteger(message.samples) || message.samples !== recording.bytes / 2) {
            throw new Error('Audio sample count mismatch');
          }
          if (recording.bytes === 0) throw new Error('Empty recording');
          clearTimers();
          const previous = recording; recording = undefined;
          const path = previous.finish(true);
          log(`■ WAV сохранён (${(previous.bytes / (2 * previous.sampleRate)).toFixed(2)} с): ${path}`);
          send({ type: 'saved', samples: message.samples });
          jobs++;
          inference = inference.then(async () => {
            try {
              log('Распознаю…');
              const text = await options.transcribe(path);
              log(`\nТекст: ${text || '(речь не распознана)'}\n`);
              send({ type: 'transcript', text });
              const power = humidifierCommand(text);
              if (power && options.setHumidifierPower) {
                let reply: string;
                try {
                  reply = await options.setHumidifierPower(power);
                } catch (error) {
                  log(`Ошибка управления увлажнителем: ${error instanceof Error ? error.message : error}`);
                  return;
                }
                log(reply);
                if (options.synthesizeReply) {
                  const output = path.replace(/\.wav$/, '.reply.wav');
                  try {
                    await options.synthesizeReply(reply, output);
                    log(`Голос Пятницы: ${output}`);
                  } catch (error) {
                    log(`Ошибка синтеза речи: ${error}`);
                  }
                }
              }
            } catch (error) {
              log(`Ошибка распознавания (WAV сохранён): ${error}`);
              send({ type: 'transcription_error', message: String(error) });
            } finally { jobs--; }
          });
        } else if (message.type === 'abort') {
          abort('ESP32 reported lost samples'); send({ type: 'aborted' });
        } else { throw new Error('Unknown message'); }
      } catch (error) { fail(error instanceof Error ? error.message : 'Invalid message'); }
    });
    socket.on('close', () => {
      abort('Connection closed');
      if (currentSocket === socket) currentSocket = undefined;
      log('Соединение ESP32 закрыто.');
    });
    socket.on('error', (error) => { abort(error.message); });
  });
  return app;
}
