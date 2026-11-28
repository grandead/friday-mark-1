import { z } from 'zod';
import type { Models } from '@/services/database';

const CREDENTIALS = z.strictObject({
  ip: z.ipv4(),
  token: z
    .string()
    .regex(/^[a-fA-F0-9]{32}$/)
    .transform((token) => token.toLowerCase()),
});
type DeviceRegistrationType = Models.public_HomeDeviceType['registrationType'];

export class RegistrationDataError extends Error {
  constructor(readonly registrationType: DeviceRegistrationType) {
    super(`Invalid registration data for ${registrationType}`);
  }
}

export function parseDeviceRegistration(type: DeviceRegistrationType, value: unknown) {
  // Do not put rejected credentials into error messages.
  const parsed = CREDENTIALS.safeParse(value);
  if (!parsed.success) throw new RegistrationDataError(type);
  if (type === 'syncleoToken' && /^0+$/.test(parsed.data.token))
    throw new RegistrationDataError(type);
  return parsed.data;
}
