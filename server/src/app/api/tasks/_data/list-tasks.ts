import { USER_ID } from '@/config/identity';
import { orm } from '@/services/database';

export function listTasks() {
  return orm.Task.select('id', 'title', 'description', 'status', 'createdAt', 'createdBy')
    .where({ deletedAt: null })
    .where((task) => task.members.some((member) => member.userId.eq(USER_ID)))
    .orderBy([(task) => task.createdAt.asc(), (task) => task.id.asc()])
    .all();
}
