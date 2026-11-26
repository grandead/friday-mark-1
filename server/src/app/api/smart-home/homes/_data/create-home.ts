import { orm } from '@/services/database';
import type { HomeInput } from '../route';
export async function createHome(input: HomeInput) {
  return orm.Home.select('id', 'displayName').create(input);
}
