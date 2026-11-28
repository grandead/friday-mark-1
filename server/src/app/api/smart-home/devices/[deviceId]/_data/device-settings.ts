import { type Database, db, orm } from '@/services/database';
import { parseDeviceRegistration } from '../../_lib/device-registration';
import type { DeviceChanges } from '../route';

type Credentials = ReturnType<typeof parseDeviceRegistration>;

export async function getDeviceSettings(id: string) {
  const device = await orm.HomeDevice.select('displayName', 'registrationData').firstOrThrow({
    id,
  });
  const { ip } = device.registrationData as Credentials;
  return { displayName: device.displayName, ip };
}

export function updateDevice(id: string, changes: DeviceChanges) {
  return db.transaction((tx) => saveChanges(tx, id, changes));
}

async function saveChanges(tx: Pick<Database, 'orm'>, id: string, changes: DeviceChanges) {
  const devices = tx.orm.public.HomeDevice;
  const { displayName, ...credentials } = changes;
  const fields: { displayName?: string; registrationData?: Credentials } = {};
  if (displayName !== undefined) fields.displayName = displayName;
  if (credentials.ip !== undefined || credentials.token !== undefined) {
    const device = await devices
      .select('registrationData', 'typeId')
      .forUpdate()
      .firstOrThrow({ id });
    const type = await tx.orm.public.HomeDeviceType.select('registrationType').firstOrThrow({
      id: device.typeId,
    });
    const stored = device.registrationData as Credentials;
    fields.registrationData = parseDeviceRegistration(type.registrationType, {
      ...stored,
      ...credentials,
    });
  }
  return devices
    .where({ id })
    .select('id', 'roomId', 'typeId', 'displayName')
    .updateAll(fields)
    .firstOrThrow();
}

export function deleteDevice(id: string) {
  return orm.HomeDevice.where({ id }).select('id').deleteAll().firstOrThrow();
}
