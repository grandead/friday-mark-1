import { createLiveStream } from '@/services/live-stream';
import { errorResponse } from '../../../../../shared/errors';
import { taskChange } from './_lib/task-events';

export function GET(request: Request) {
  try {
    const handlers = { 'task.updated': taskChange, 'task.deleted': taskChange };
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
