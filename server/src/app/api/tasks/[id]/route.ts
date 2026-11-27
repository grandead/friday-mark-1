import { z } from 'zod';
import { publish } from '@/services/signals';
import { errorResponse } from '../../../../../shared/errors';
import { taskErrorResponse } from '../_lib/task-error-response';
import { TASK_FIELDS } from '../_lib/task-fields';
import { deleteTask } from './_data/delete-task';
import { updateTask } from './_data/update-task';

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  try {
    const params = await context.params;
    const id = TASK_ID.parse(params.id);
    const body = await request.json();
    const input = INPUT_SCHEMA.parse(body);
    const task = await updateTask(id, input);
    if (!task) {
      const error = errorResponse('task_not_found');
      return Response.json(error, { status: 404 });
    }
    publish('task.updated', { id });
    return Response.json(task);
  } catch (error) {
    return taskErrorResponse(error);
  }
}

export async function DELETE(_request: Request, context: Context) {
  try {
    const params = await context.params;
    const id = TASK_ID.parse(params.id);
    const task = await deleteTask(id);
    if (!task) {
      const error = errorResponse('task_not_found');
      return Response.json(error, { status: 404 });
    }
    publish('task.deleted', task);
    return new Response(null, { status: 204 });
  } catch (error) {
    return taskErrorResponse(error);
  }
}

const TASK_ID = z.uuidv7();
const INPUT_FIELDS = { ...TASK_FIELDS, status: z.enum(['Pending', 'Done']) };
const INPUT_SCHEMA = z
  .strictObject(INPUT_FIELDS)
  .partial()
  .refine((input) => Object.keys(input).length > 0);

export type UpdateTaskInput = z.infer<typeof INPUT_SCHEMA>;
