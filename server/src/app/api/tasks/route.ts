import { z } from 'zod';
import { publish } from '@/services/signals';
import { createTask } from './_data/create-task';
import { listTasks } from './_data/list-tasks';
import { taskErrorResponse } from './_lib/task-error-response';
import { TASK_FIELDS } from './_lib/task-fields';

export async function GET() {
  try {
    const tasks = await listTasks();
    return Response.json(tasks);
  } catch (error) {
    return taskErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const input = INPUT_SCHEMA.parse(body);
    const task = await createTask(input);
    publish('task.updated', { id: task.id });
    return Response.json(task, { status: 201 });
  } catch (error) {
    return taskErrorResponse(error);
  }
}

const USER_ID_FIELD = z.uuidv7();
const CREATE_FIELDS = { ...TASK_FIELDS, userIds: z.array(USER_ID_FIELD).optional() };
const INPUT_SCHEMA = z.strictObject(CREATE_FIELDS);
export type CreateTaskInput = z.infer<typeof INPUT_SCHEMA>;
