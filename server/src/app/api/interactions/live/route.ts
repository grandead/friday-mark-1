import { createLiveStream } from '@/services/live-stream';
import { errorResponse } from '../../../../../shared/errors';
import { getInteractionData } from './_lib/get-interaction-data';

export function GET(request: Request) {
  try {
    const handlers = { 'interaction.updated': getInteractionData };
    const stream = createLiveStream(request.signal, handlers);
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch {
    const error = errorResponse('internal_error');
    return Response.json(error, { status: 500 });
  }
}
