import { USER_ID } from '@/config/identity';
import { orm } from '@/services/database';
import type { CreateTaskInput } from '../route';

export function createTask({ userIds = [], ...fields }: CreateTaskInput) {
  const participants = new Set([USER_ID, ...userIds]);
  const rows = Array.from(participants, (userId) => ({ userId }));
  return orm.Task.select('id', 'title', 'description', 'status', 'createdAt', 'createdBy').create({
    ...fields,
    createdBy: USER_ID,
    members: (members) => members.create(rows),
  });
}
