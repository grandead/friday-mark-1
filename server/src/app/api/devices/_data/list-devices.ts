import { orm } from '@/services/database';
export function listDevices() {
  return orm.Device.select('id', 'displayName')
    .orderBy([(row) => row.displayName.asc(), (row) => row.id.asc()])
    .all();
}
