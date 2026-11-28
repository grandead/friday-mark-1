import { AppError } from '../../../../shared/errors';
import { orm } from '../../database';
import type { MiioCredentials, SyncleoCredentials } from '../../smart-home';

export async function getDevice(id: string) {
  const device = await orm.HomeDevice.select('registrationData', 'displayName')
    .include('type', (type) => type.select('code'))
    .include('room', (room) => room.select('displayName'))
    .first({ id });
  if (!device) return null;
  if (!device.type || !device.room) throw new AppError('internal_error');
  return {
    model: device.type.code,
    name: device.displayName,
    room: device.room.displayName,
    credentials: device.registrationData as MiioCredentials | SyncleoCredentials,
  };
}
