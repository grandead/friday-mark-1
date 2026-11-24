import type { DeviceRegistrationType } from '@prisma/client';
import { z } from 'zod';

export const homeDeviceInput = z.strictObject({
  roomId: z.uuidv7(),
  typeId: z.uuidv7(),
  displayName: z.string().trim().min(1).max(120),
  registrationData: z.unknown(),
});

export const deviceRegistrationSchemas = {
  miioToken: z.strictObject({
    ip: z.ipv4(),
    token: z
      .string()
      .regex(/^[a-fA-F0-9]{32}$/)
      .transform((token) => token.toLowerCase()),
  }),
  hommynShareUrl: z.strictObject({
    shareUrl: z
      .string()
      .trim()
      .max(4096)
      .refine((value) => {
        try {
          const url = new URL(value);
          return (
            url.protocol === 'rusklimat:' &&
            url.hostname === 'device-share' &&
            /^\/rusclimate\/\d+\/[^/]+\/?$/.test(url.pathname) &&
            Boolean(url.searchParams.get('token')?.trim())
          );
        } catch {
          return false;
        }
      }, 'Expected a HOMMYN device share URL with a token'),
  }),
} satisfies Record<DeviceRegistrationType, z.ZodType>;

export class RegistrationDataError extends Error {
  constructor(readonly registrationType: DeviceRegistrationType) {
    super(`Invalid registration data for ${registrationType}`);
  }
}

export function parseDeviceRegistration(type: DeviceRegistrationType, value: unknown) {
  // Do not put rejected credentials or URLs into error messages.
  const parsed = deviceRegistrationSchemas[type].safeParse(value);
  if (!parsed.success) throw new RegistrationDataError(type);
  return parsed.data;
}
