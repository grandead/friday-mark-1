import { orm } from '@/services/database';
import type { parseDeviceRegistration } from '../_lib/device-registration';
import type { DeviceInput } from '../route';
export function createDevice(
  input: Omit<DeviceInput, 'registrationData'> & {
    registrationData: ReturnType<typeof parseDeviceRegistration>;
  },
) {
  return orm.HomeDevice.select('id', 'roomId', 'typeId', 'displayName', 'createdAt').create(input);
}
