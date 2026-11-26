import { z } from 'zod';
import type { Models } from '@/services/database';

const MIIO_FIELDS = {
  ip: z.ipv4(),
  token: z
    .string()
    .regex(/^[a-fA-F0-9]{32}$/)
    .transform((token) => token.toLowerCase()),
};
const HOMMYN_FIELDS = {
  shareUrl: z
    .string()
    .trim()
    .max(4096)
    .refine(isBalluLink, 'Expected a valid HOMMYN ASP-100 share URL')
    .transform((value) => new URL(value).href),
};
const DEVICE_REGISTRATION_SCHEMAS = {
  miioToken: z.strictObject(MIIO_FIELDS),
  hommynShareUrl: z.strictObject(HOMMYN_FIELDS),
} satisfies Record<DeviceRegistrationType, z.ZodType>;

type DeviceRegistrationType = Models.public_HomeDeviceType['registrationType'];

export class RegistrationDataError extends Error {
  constructor(readonly registrationType: DeviceRegistrationType) {
    super(`Invalid registration data for ${registrationType}`);
  }
}

export function parseDeviceRegistration(type: DeviceRegistrationType, value: unknown) {
  // Do not put rejected credentials or URLs into error messages.
  const parsed = DEVICE_REGISTRATION_SCHEMAS[type].safeParse(value);
  if (!parsed.success) throw new RegistrationDataError(type);
  return parsed.data;
}

function isBalluLink(value: string) {
  try {
    const url = new URL(value);
    const path = /^\/rusclimate\/69\/([^/]+)\/?$/.exec(url.pathname);
    if (!path) return false;
    const mac = decodeURIComponent(path[1]);
    const token = url.searchParams.get('token') ?? '';
    return (
      url.protocol === 'rusklimat:' &&
      url.host === 'device-share' &&
      !url.username &&
      !url.password &&
      !!mac &&
      /^(?:[\da-f]{12}|(?:[\da-f]{2}[:-]){5}[\da-f]{2})$/i.test(mac) &&
      /^[\da-f]{32}$/i.test(token) &&
      !/^0+$/.test(token)
    );
  } catch {
    return false;
  }
}
