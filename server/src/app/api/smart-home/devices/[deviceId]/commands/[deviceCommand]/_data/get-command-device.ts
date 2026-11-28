import { orm } from '@/services/database';
import type { MiioCredentials, SyncleoCredentials } from '@/services/smart-home';

export async function getCommandDevice(id: string) {
  const device = await orm.HomeDevice.select('registrationData')
    .include('type', (type) => type.select('code'))
    .first({ id });
  if (!device) return null;
  if (!device.type) throw new Error('Device model is missing.');
  return {
    model: device.type.code,
    credentials: device.registrationData as MiioCredentials | SyncleoCredentials,
  };
}
