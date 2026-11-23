import type { PrismaClient } from '@prisma/client';
import { homeDeviceInput, parseDeviceRegistration } from '../validation/homeDevice.js';

// The catalogue determines registration type; clients cannot override it.
export async function createHomeDevice(db: PrismaClient, input: unknown) {
  const { registrationData, ...device } = homeDeviceInput.parse(input);
  const type = await db.homeDeviceType.findUniqueOrThrow({ where: { id: device.typeId } });
  return db.homeDevice.create({
    data: { ...device, registrationData: parseDeviceRegistration(type.registrationType, registrationData) },
    select: { id: true, roomId: true, typeId: true, displayName: true, createdAt: true },
  });
}
