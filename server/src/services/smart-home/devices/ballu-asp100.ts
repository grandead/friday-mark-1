import { z } from 'zod';
import { type DeviceCredentials, runCommand } from '../drivers/syncleo';
import { confirm, parseState } from '../utils';

export const GET_STATE_SCHEMA = z.strictObject({});

const BALLU_STATE = z.strictObject({
  power: z.boolean(),
  mode: z.enum(['off', 'auto', 'manual', 'night', 'turbo', 'eco']).optional(),
  speed: z.number().int().min(0).max(8).optional(),
  targetTemperature: z.number().min(0).max(25).optional(),
  heaterInstalled: z.boolean().optional(),
  co2SensorInstalled: z.boolean().optional(),
  buttonSound: z.boolean().optional(),
  backlightAutoOff: z.boolean().optional(),
  sound: z.enum(['off', 'rain', 'sea', 'forest', 'birds', 'fireplace']).optional(),
  filterCounter: z.number().int().nonnegative().max(65535).optional(),
  errorCode: z.number().int().nonnegative().optional(),
  turboSeconds: z.number().int().nonnegative().optional(),
  humidity: z.number().min(0).max(100).optional(),
  temperature: z.number().min(-60).max(100).optional(),
  co2: z.number().nonnegative().optional(),
  pm25: z.number().nonnegative().optional(),
});

export type BalluState = z.infer<typeof BALLU_STATE>;

export const SET_POWER_SCHEMA = z.strictObject({
  power: z.boolean(),
});

export const SET_MODE_SCHEMA = z.strictObject({
  mode: z.enum(['manual', 'night', 'turbo', 'eco']),
});

export const SET_SPEED_SCHEMA = z.strictObject({
  speed: z.number().int().min(1).max(7),
});

export const SET_BACKLIGHT_AUTO_OFF_SCHEMA = z.strictObject({ enabled: z.boolean() });

export const SET_BUTTON_SOUND_SCHEMA = z.strictObject({ enabled: z.boolean() });

export const RESET_FILTER_SCHEMA = z.strictObject({});

export const SET_SOUND_SCHEMA = z.strictObject({
  sound: z.enum(['off', 'rain', 'sea', 'forest', 'birds', 'fireplace']),
});

export const SET_TEMPERATURE_SCHEMA = z.strictObject({
  temperature: z.number().int().min(5).max(25),
});

export async function getState(
  credentials: DeviceCredentials,
  args: z.infer<typeof GET_STATE_SCHEMA>,
): Promise<BalluState> {
  const response = await runCommand('state', credentials, args);
  return parseState(BALLU_STATE, response);
}

export async function setPower(
  credentials: DeviceCredentials,
  args: z.infer<typeof SET_POWER_SCHEMA>,
) {
  const response = await runCommand('power', credentials, args);
  const state = parseState(BALLU_STATE, response);
  confirm(state.power === args.power);
  return state;
}

export async function setMode(
  credentials: DeviceCredentials,
  args: z.infer<typeof SET_MODE_SCHEMA>,
) {
  const response = await runCommand('mode', credentials, args);
  const state = parseState(BALLU_STATE, response);
  confirm(state.mode === args.mode && state.power);
  return state;
}

export async function setSpeed(
  credentials: DeviceCredentials,
  args: z.infer<typeof SET_SPEED_SCHEMA>,
) {
  const response = await runCommand('speed', credentials, args);
  const state = parseState(BALLU_STATE, response);
  confirm(state.speed === args.speed && state.mode === 'manual' && state.power);
  return state;
}

export async function setBacklightAutoOff(
  credentials: DeviceCredentials,
  args: z.infer<typeof SET_BACKLIGHT_AUTO_OFF_SCHEMA>,
) {
  const response = await runCommand('backlightAutoOff', credentials, args);
  const state = parseState(BALLU_STATE, response);
  confirm(state.backlightAutoOff === args.enabled);
  return state;
}

export async function setButtonSound(
  credentials: DeviceCredentials,
  args: z.infer<typeof SET_BUTTON_SOUND_SCHEMA>,
) {
  const response = await runCommand('buttonSound', credentials, args);
  const state = parseState(BALLU_STATE, response);
  confirm(state.buttonSound === args.enabled);
  return state;
}

export async function resetFilter(
  credentials: DeviceCredentials,
  args: z.infer<typeof RESET_FILTER_SCHEMA>,
) {
  const response = await runCommand('resetFilter', credentials, args);
  const state = parseState(BALLU_STATE, response);
  confirm(state.filterCounter === 0);
  return state;
}

export async function setSound(
  credentials: DeviceCredentials,
  args: z.infer<typeof SET_SOUND_SCHEMA>,
) {
  const response = await runCommand('sound', credentials, args);
  const state = parseState(BALLU_STATE, response);
  confirm(state.sound === args.sound);
  return state;
}

export async function setTemperature(
  credentials: DeviceCredentials,
  args: z.infer<typeof SET_TEMPERATURE_SCHEMA>,
) {
  const response = await runCommand('targetTemperature', credentials, args);
  const state = parseState(BALLU_STATE, response);
  confirm(state.targetTemperature === args.temperature && state.heaterInstalled === true);
  return state;
}
