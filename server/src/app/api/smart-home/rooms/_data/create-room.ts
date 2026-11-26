import { orm } from '@/services/database';
import type { RoomInput } from '../route';
export async function createRoom(input: RoomInput) {
  await orm.Home.select('id').firstOrThrow({ id: input.homeId });
  return orm.Room.select('id', 'homeId', 'displayName').create(input);
}
