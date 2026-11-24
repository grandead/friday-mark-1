import { errorResponse } from '../../shared/errors.js';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { audioKey, listDevices, listInteractions, listUsers } from '../services/journal/journal.js';
import { audioParams, journalQuery } from '../services/validation/journal.js';

export async function journalRoutes(
  app: FastifyInstance,
  { db, recordingsDir }: { db: PrismaClient; recordingsDir: string },
) {
  app.get('/api/users', () => listUsers(db));
  app.get('/api/devices', () => listDevices(db));
  app.get('/api/interactions', async (request, reply) => {
    const query = journalQuery.safeParse(request.query);
    if (!query.success) return reply.code(400).send(errorResponse('invalid_journal_query'));
    return listInteractions(db, query.data);
  });
  app.get('/api/interactions/:id/audio/:kind', async (request, reply) => {
    const params = audioParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send(errorResponse('invalid_audio_path'));
    const key = await audioKey(db, params.data.id, params.data.kind);
    if (!key) return reply.code(404).send(errorResponse('audio_not_found'));
    return reply.type('audio/wav').sendFile(key, recordingsDir);
  });
}
