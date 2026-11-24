import { z } from 'zod';
import type { DeviceModel } from '../model.js';
import {
  basicCommands,
  humidity,
  joinDescription,
  powerDescription,
  temperature,
} from './common.js';

export const smartmiState = z.strictObject({
  power: z.boolean(),
  humidity,
  temperature,
  co2: z.number().nonnegative().optional(),
  pm25: z.number().nonnegative().optional(),
});
export function describeSmartmiState(state: z.infer<typeof smartmiState>) {
  return joinDescription([
    powerDescription(state),
    state.humidity === undefined ? undefined : `Влажность ${state.humidity} процентов.`,
    state.temperature === undefined ? undefined : `Температура ${state.temperature} градусов.`,
    state.co2 === undefined ? undefined : `CO2 ${state.co2} ppm.`,
    state.pm25 === undefined ? undefined : `PM2.5 ${state.pm25} микрограммов на кубометр.`,
  ]);
}
export const smartmiFreshAir: DeviceModel = {
  code: 'smartmi-fresh-air',
  transport: 'miio',
  registrationType: 'miioToken',
  commands: basicCommands(smartmiState, describeSmartmiState),
};
