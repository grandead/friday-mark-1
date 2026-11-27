import type { listTasks } from '../app/api/tasks/_data/list-tasks';
import { requestError } from './errors';

type TaskRow = Awaited<ReturnType<typeof listTasks>>[number];
export type Task = Omit<TaskRow, 'createdAt'> & { createdAt: string };

export async function writeTask(
  method: 'POST' | 'PATCH' | 'DELETE',
  id?: string,
  fields?: {
    title?: string;
    description?: string | null;
    status?: Task['status'];
  },
) {
  const url = id ? `/api/tasks/${id}` : '/api/tasks';
  const body = JSON.stringify(fields);
  const headers = fields ? { 'Content-Type': 'application/json' } : undefined;
  const response = await fetch(url, { method, body, headers });
  if (!response.ok) throw await requestError(response);
}
