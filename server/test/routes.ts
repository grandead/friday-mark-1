import type { Database } from '../src/services/database';
import { withServiceResources } from './service-resources';

export const routes = {
  health: (await import('../src/app/api/health/route')).GET,
  users: (await import('../src/app/api/users/route')).GET,
  devices: (await import('../src/app/api/devices/route')).GET,
  interactions: (await import('../src/app/api/interactions/route')).GET,
  live: (await import('../src/app/api/interactions/live/route')).GET,
  audio: (await import('../src/app/api/audio/[id]/[kind]/route')).GET,
  homes: (await import('../src/app/api/smart-home/route')).GET,
  createHome: (await import('../src/app/api/smart-home/homes/route')).POST,
  createRoom: (await import('../src/app/api/smart-home/rooms/route')).POST,
  createDevice: (await import('../src/app/api/smart-home/devices/route')).POST,
};

export function withRouteResources<T>(
  resources: { db: Database; recordingsDir: string },
  run: () => T,
) {
  return withServiceResources(resources, run);
}
