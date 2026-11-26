import { orm } from '@/services/database';
export async function getDeviceType(roomId: string, typeId: string) {
  await orm.Room.select('id').firstOrThrow({ id: roomId });
  return orm.HomeDeviceType.select('registrationType').firstOrThrow({ id: typeId });
}
