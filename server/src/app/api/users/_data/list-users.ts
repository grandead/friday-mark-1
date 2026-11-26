import { orm } from '@/services/database';
export function listUsers() {
  return orm.User.select('id', 'displayName')
    .orderBy([(row) => row.displayName.asc(), (row) => row.id.asc()])
    .all();
}
