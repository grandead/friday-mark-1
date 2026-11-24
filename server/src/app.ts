import { mkdirSync } from 'node:fs';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import Fastify from 'fastify';
import { healthRoutes } from './api/health.js';
import { journalRoutes } from './api/journal.js';
import { createJournalEvents } from './api/journalEvents.js';
import { smartHomeRoutes } from './api/smartHome.js';
import { RecordingSession } from './services/audio/session.js';
import { InteractionProcessor, type ProcessingOptions } from './services/interactions/processor.js';
import { audioRoutes } from './ws/audio.js';

type Options = ProcessingOptions & { recordingsDir: string; recognizer?: string; webDir?: string };

export async function buildApp(options: Options) {
  const app = Fastify({ logger: false });
  const journalEvents = createJournalEvents(options.db, options.log ?? console.log);
  const processor = new InteractionProcessor(options, journalEvents.interactionUpdated);
  const { db, recordingsDir, recognizer, log = console.log } = options;
  mkdirSync(recordingsDir, { recursive: true });

  app.addHook('onClose', () => processor.drain());
  await app.register(websocket, { options: { maxPayload: 8192, perMessageDeflate: false } });
  await app.register(fastifyStatic, {
    root: options.webDir ?? recordingsDir,
    serve: Boolean(options.webDir),
  });
  if (options.webDir) app.get('/smart-home', (_request, reply) => reply.sendFile('index.html'));
  await app.register(smartHomeRoutes, { db });
  await app.register(journalEvents.routes);
  await app.register(journalRoutes, { db, recordingsDir });
  await app.register(healthRoutes, { processor, recognizer });
  await app.register(audioRoutes, {
    log,
    openSession: (send, onTimeout) =>
      new RecordingSession({ db, recordingsDir, processor, log }, send, onTimeout),
  });
  return app;
}
