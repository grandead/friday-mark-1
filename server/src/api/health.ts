import type { FastifyInstance } from 'fastify';
import type { InteractionProcessor } from '../services/interactions/processor.js';

export async function healthRoutes(app: FastifyInstance, options: { processor: InteractionProcessor; recognizer?: string }) {
  app.get('/health', async () => ({
    ok: true,
    transcriptionJobs: options.processor.pendingJobs,
    recognizer: options.recognizer,
  }));
}
