import { USER_ID } from '@/config/identity';
import { orm } from '@/services/database';
import type { UpdateTaskInput } from '../route';

export function updateTask(id: string, input: UpdateTaskInput) {
  return orm.Task.select('id', 'title', 'description', 'status', 'createdAt', 'createdBy')
    .where({ id, deletedAt: null })
    .where((task) => task.members.some((member) => member.userId.eq(USER_ID)))
    .updateAll(input)
    .first();
}
