import { z } from 'zod';
import { type DeviceCredentials, runCommand } from '../drivers/miio';
import { confirm, parseState } from '../utils';

export const GET_STATE_SCHEMA = z.strictObject({});

const SMARTMI_STATE = z.strictObject({
  power: z.boolean(),
  humidity: z.number().min(0).max(100).optional(),
  temperature: z.number().min(-60).max(100).optional(),
  co2: z.number().nonnegative().optional(),
  pm25: z.number().nonnegative().optional(),
  averagePm25: z.number().nonnegative().optional(),
  mode: z.enum(['auto', 'silent', 'interval', 'low', 'middle', 'strong']).optional(),
  speed: z.number().int().min(1).max(3).optional(),
  brightness: z.enum(['bright', 'dim', 'off']).optional(),
  buzzer: z.boolean().optional(),
  childLock: z.boolean().optional(),
  heater: z.boolean().optional(),
  filterHours: z.number().nonnegative().optional(),
  filterLife: z.number().min(0).max(100).optional(),
  motorRpm: z.number().nonnegative().optional(),
  useSeconds: z.number().nonnegative().optional(),
  heaterTemperature: z.number().min(-60).max(100).optional(),
});

export type SmartmiState = z.infer<typeof SMARTMI_STATE>;

export const SET_POWER_SCHEMA = z.strictObject({
  power: z.boolean(),
});

export const SET_MODE_SCHEMA = z.strictObject({
  mode: z.enum(['auto', 'silent', 'interval', 'low', 'middle', 'strong']),
});

export const SET_SPEED_SCHEMA = z.strictObject({
  speed: z.number().int().min(1).max(3),
});

export const SET_BRIGHTNESS_SCHEMA = z.strictObject({
  brightness: z.enum(['bright', 'dim', 'off']),
});

export const SET_BUZZER_SCHEMA = z.strictObject({ buzzer: z.boolean() });

export const SET_CHILD_LOCK_SCHEMA = z.strictObject({ childLock: z.boolean() });

export const SET_HEATER_SCHEMA = z.strictObject({ heater: z.boolean() });

export const RESET_FILTER_SCHEMA = z.strictObject({});

export async function getState(
  credentials: DeviceCredentials,
  args: z.infer<typeof GET_STATE_SCHEMA>,
): Promise<SmartmiState> {
  const response = await runCommand('smartmi-fresh-air.state', credentials, args);
  return parseState(SMARTMI_STATE, response);
}

export async function setPower(
  credentials: DeviceCredentials,
  args: z.infer<typeof SET_POWER_SCHEMA>,
) {
  const response = await runCommand('smartmi-fresh-air.power', credentials, args);
  const state = parseState(SMARTMI_STATE, response);
  confirm(state.power === args.power);
  return state;
}

export async function setMode(
  credentials: DeviceCredentials,
  args: z.infer<typeof SET_MODE_SCHEMA>,
) {
  const response = await runCommand('smartmi-fresh-air.mode', credentials, args);
  const state = parseState(SMARTMI_STATE, response);
  confirm(state.mode === args.mode);
  return state;
}

export async function setSpeed(
  credentials: DeviceCredentials,
  args: z.infer<typeof SET_SPEED_SCHEMA>,
) {
  const response = await runCommand('smartmi-fresh-air.speed', credentials, args);
  const state = parseState(SMARTMI_STATE, response);
  confirm(state.speed === args.speed);
  return state;
}

export async function setBrightness(
  credentials: DeviceCredentials,
  args: z.infer<typeof SET_BRIGHTNESS_SCHEMA>,
) {
  const response = await runCommand('smartmi-fresh-air.brightness', credentials, args);
  const state = parseState(SMARTMI_STATE, response);
  confirm(state.brightness === args.brightness);
  return state;
}

export async function setBuzzer(
  credentials: DeviceCredentials,
  args: z.infer<typeof SET_BUZZER_SCHEMA>,
) {
  const response = await runCommand('smartmi-fresh-air.buzzer', credentials, args);
  const state = parseState(SMARTMI_STATE, response);
  confirm(state.buzzer === args.buzzer);
  return state;
}

export async function setChildLock(
  credentials: DeviceCredentials,
  args: z.infer<typeof SET_CHILD_LOCK_SCHEMA>,
) {
  const response = await runCommand('smartmi-fresh-air.childLock', credentials, args);
  const state = parseState(SMARTMI_STATE, response);
  confirm(state.childLock === args.childLock);
  return state;
}

export async function setHeater(
  credentials: DeviceCredentials,
  args: z.infer<typeof SET_HEATER_SCHEMA>,
) {
  const response = await runCommand('smartmi-fresh-air.heater', credentials, args);
  const state = parseState(SMARTMI_STATE, response);
  confirm(state.heater === args.heater);
  return state;
}

export async function resetFilter(
  credentials: DeviceCredentials,
  args: z.infer<typeof RESET_FILTER_SCHEMA>,
) {
  const response = await runCommand('smartmi-fresh-air.resetFilter', credentials, args);
  const state = parseState(SMARTMI_STATE, response);
  confirm(state.filterHours === 0);
  return state;
}
