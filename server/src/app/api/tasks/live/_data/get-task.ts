import { USER_ID } from '@/config/identity';
import { orm } from '@/services/database';

export function getTask(id: string) {
  return orm.Task.select(
    'id',
    'title',
    'description',
    'status',
    'createdAt',
    'createdBy',
    'deletedAt',
  )
    .where((task) => task.members.some((member) => member.userId.eq(USER_ID)))
    .first({ id });
}
