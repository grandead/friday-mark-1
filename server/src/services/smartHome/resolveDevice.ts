import type { PrismaClient } from '@prisma/client';
import type { DeviceSelector } from './model.js';

const normalize = (value: string) =>
  value.toLocaleLowerCase('ru').replaceAll('ё', 'е').trim().replace(/\s+/gu, ' ');
export async function resolveDevice(db: PrismaClient, input: DeviceSelector) {
  // Resolve metadata first; credentials are loaded only for one unambiguous device.
  const devices = await db.homeDevice.findMany({
    select: {
      id: true,
      displayName: true,
      type: { select: { code: true, registrationType: true } },
      room: { select: { displayName: true, home: { select: { displayName: true } } } },
    },
  });
  const matches = devices.filter(
    (device) =>
      normalize(device.displayName) === normalize(input.device) &&
      (!input.room || normalize(device.room.displayName) === normalize(input.room)) &&
      (!input.home || normalize(device.room.home.displayName) === normalize(input.home)),
  );
  if (!matches.length)
    return {
      ok: false,
      reply:
        'Не нашла такое устройство. Назовите его и комнату так, как они записаны в умном доме.',
    } as const;
  if (matches.length > 1)
    return {
      ok: false,
      reply: `Уточните, какое устройство: ${matches.map((device) => `${device.displayName}, ${device.room.displayName}, ${device.room.home.displayName}`).join('; ')}?`,
    } as const;
  return { ok: true, device: matches[0] } as const;
}
