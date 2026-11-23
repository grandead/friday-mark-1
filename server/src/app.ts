import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import { mkdirSync } from 'node:fs';
import { healthRoutes } from './api/health.js';
import { audioRoutes } from './ws/audio.js';
import { InteractionProcessor, type ProcessingOptions } from './services/interactions/processor.js';
import { RecordingSession } from './services/audio/session.js';

type Options = ProcessingOptions & { recordingsDir: string; recognizer?: string };

export async function buildApp(options: Options) {
  const app = Fastify({ logger: false });
  const processor = new InteractionProcessor(options);
  const { db, recordingsDir, recognizer, log = console.log } = options;
  mkdirSync(recordingsDir, { recursive: true });

  app.addHook('onClose', () => processor.drain());
  await app.register(websocket, { options: { maxPayload: 8192, perMessageDeflate: false } });
  await app.register(healthRoutes, { processor, recognizer });
  await app.register(audioRoutes, {
    log,
    openSession: (send, onTimeout) => new RecordingSession({ db, recordingsDir, processor, log }, send, onTimeout),
  });
  return app;
}
