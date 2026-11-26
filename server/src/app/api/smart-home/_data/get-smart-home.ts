import { orm } from '@/services/database';
export async function getSmartHome() {
  const homesQuery = orm.Home.select('id', 'displayName')
    .include('rooms', selectRooms)
    .orderBy([(r) => r.createdAt.asc(), (r) => r.id.asc()])
    .all();
  const deviceTypesQuery = orm.HomeDeviceType.select(
    'id',
    'code',
    'displayName',
    'kind',
    'registrationType',
  )
    .orderBy((r) => r.displayName.asc())
    .all();
  const [homes, deviceTypes] = await Promise.all([homesQuery, deviceTypesQuery]);
  return { homes, deviceTypes };
}

function selectRooms(rooms: Pick<typeof orm.Room, 'select'>) {
  return rooms
    .select('id', 'homeId', 'displayName')
    .include('devices', selectDevices)
    .orderBy([(room) => room.createdAt.asc(), (room) => room.id.asc()]);
}
function selectDevices(devices: Pick<typeof orm.HomeDevice, 'select'>) {
  return devices
    .select('id', 'roomId', 'typeId', 'displayName')
    .orderBy([(device) => device.createdAt.asc(), (device) => device.id.asc()]);
}
