import type { PrismaClient } from '@prisma/client';
import { getJournalEntry } from '../services/journal/journal.js';
import type { FastifyInstance } from 'fastify';
import type { ServerResponse } from 'node:http';

export function createJournalEvents(db: PrismaClient, log: (message: string) => void) {
  const clients = new Set<ServerResponse>();

  async function routes(app: FastifyInstance) {
    app.get('/api/journal/events', (_request, reply) => {
      reply.hijack();
      const response = reply.raw;
      response.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
      });
      response.write(': connected\n\n');
      clients.add(response);
      const heartbeat = setInterval(() => response.write(': heartbeat\n\n'), 25_000);
      response.once('close', () => {
        clearInterval(heartbeat);
        clients.delete(response);
      });
    });

    app.addHook('preClose', async () => {
      for (const response of clients) response.end();
    });
  }

  async function interactionUpdated(id: string) {
    // A delivery failure must not turn a successfully processed interaction into a failure.
    try {
      const entry = await getJournalEntry(db, id);
      if (!entry) return;
      const frame = `event: interactionUpdated\ndata: ${JSON.stringify(entry)}\n\n`;
      for (const response of clients) {
        response.write(frame);
      }
    } catch (error) {
      log(`Ошибка обновления журнала: ${error}`);
    }
  }

  return { routes, interactionUpdated };
}
