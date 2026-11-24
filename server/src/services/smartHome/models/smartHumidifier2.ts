import { z } from 'zod';
import type { DeviceModel } from '../model.js';
import { basicCommands, humidity, joinDescription, powerDescription } from './common.js';

export const humidifierState = z.strictObject({ power: z.boolean(), humidity });
export function describeHumidifierState(state: z.infer<typeof humidifierState>) {
  return joinDescription([
    powerDescription(state),
    state.humidity === undefined ? undefined : `Влажность ${state.humidity} процентов.`,
  ]);
}
export const smartHumidifier2: DeviceModel = {
  code: 'xiaomi-smart-humidifier-2',
  transport: 'miio',
  registrationType: 'miioToken',
  commands: basicCommands(humidifierState, describeHumidifierState),
};
