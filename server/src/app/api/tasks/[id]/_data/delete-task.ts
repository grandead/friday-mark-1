import { USER_ID } from '@/config/identity';
import { orm } from '@/services/database';

export function deleteTask(id: string) {
  const deletedAt = new Date();
  return orm.Task.select('id')
    .where({ id, deletedAt: null })
    .where((task) => task.members.some((member) => member.userId.eq(USER_ID)))
    .updateAll({ deletedAt, deletedBy: USER_ID })
    .first();
}
