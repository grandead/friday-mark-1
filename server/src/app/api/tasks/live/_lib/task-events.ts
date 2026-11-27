import type { Signals } from '@/services/signals';
import { getTask } from '../_data/get-task';

export async function taskChange({ id }: Signals['task.updated']) {
  const row = await getTask(id);
  if (!row) return null;
  const { deletedAt, ...task } = row;
  return { id, task: deletedAt ? null : task };
}
