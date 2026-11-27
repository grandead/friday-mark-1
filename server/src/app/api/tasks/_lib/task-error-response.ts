import { z } from 'zod';
import { errorResponse } from '../../../../../shared/errors';

export function taskErrorResponse(error: unknown) {
  if (error instanceof z.ZodError || error instanceof SyntaxError) {
    const body = errorResponse('invalid_task_request');
    return Response.json(body, { status: 400 });
  }
  if (
    error instanceof Error &&
    'constraint' in error &&
    (error.constraint === 'tasks_createdBy_fkey' || error.constraint === 'taskUsers_userId_fkey') &&
    'sqlState' in error &&
    error.sqlState === '23503'
  ) {
    const body = errorResponse('user_not_found');
    return Response.json(body, { status: 404 });
  }
  const body = errorResponse('internal_error');
  return Response.json(body, { status: 500 });
}
