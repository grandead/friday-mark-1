import { z } from 'zod';
import { DeviceModelCode } from '../../../../shared/device-model-code';
import { type DeviceCredentials, runCommand } from '../drivers/miio';
import { confirm, parseState } from '../utils';

const MODEL = DeviceModelCode.XiaomiSmartHumidifier2;

export const GET_STATE_SCHEMA = z.strictObject({});

const HUMIDIFIER_STATE = z.strictObject({
  power: z.boolean(),
  humidity: z.number().min(0).max(100).optional(),
  temperature: z.number().min(-60).max(100).optional(),
  mode: z.enum(['manual', 'constantHumidity']).optional(),
  level: z.number().int().min(1).max(4).optional(),
  targetHumidity: z.number().int().min(40).max(70).optional(),
  status: z.enum(['idle', 'humidifying']).optional(),
  fault: z.enum(['none', 'waterShortage', 'tankSeparated']).optional(),
  buzzer: z.boolean().optional(),
  indicator: z.boolean().optional(),
  tankLifted: z.boolean().optional(),
  waterShortage: z.boolean().optional(),
  humiditySensorFault: z.boolean().optional(),
  temperatureSensorFault: z.boolean().optional(),
  overwetProtection: z.boolean().optional(),
  overwetProtectionActive: z.boolean().optional(),
  constantProtection: z.boolean().optional(),
  constantProtectionActive: z.boolean().optional(),
});

export type HumidifierState = z.infer<typeof HUMIDIFIER_STATE>;

export const SET_POWER_SCHEMA = z.strictObject({
  power: z.boolean(),
});

export const SET_MODE_SCHEMA = z.strictObject({
  mode: z.enum(['manual', 'constantHumidity']),
});

export const SET_BUZZER_SCHEMA = z.strictObject({ buzzer: z.boolean() });

export const SET_CONSTANT_PROTECTION_SCHEMA = z.strictObject({
  constantProtection: z.boolean(),
});

export const SET_INDICATOR_SCHEMA = z.strictObject({ indicator: z.boolean() });

export const SET_LEVEL_SCHEMA = z.strictObject({
  level: z.number().int().min(1).max(4),
});

export const SET_OVERWET_PROTECTION_SCHEMA = z.strictObject({
  overwetProtection: z.boolean(),
});

export const SET_TARGET_HUMIDITY_SCHEMA = z.strictObject({
  targetHumidity: z.number().int().min(40).max(70),
});

export async function getState(
  credentials: DeviceCredentials,
  args: z.infer<typeof GET_STATE_SCHEMA>,
): Promise<HumidifierState> {
  const response = await runCommand(`${MODEL}.state`, credentials, args);
  return parseState(HUMIDIFIER_STATE, response);
}

export async function setPower(
  credentials: DeviceCredentials,
  args: z.infer<typeof SET_POWER_SCHEMA>,
) {
  const response = await runCommand(`${MODEL}.power`, credentials, args);
  const state = parseState(HUMIDIFIER_STATE, response);
  confirm(state.power === args.power);
  return state;
}

export async function setMode(
  credentials: DeviceCredentials,
  args: z.infer<typeof SET_MODE_SCHEMA>,
) {
  const response = await runCommand(`${MODEL}.mode`, credentials, args);
  const state = parseState(HUMIDIFIER_STATE, response);
  confirm(state.mode === args.mode);
  return state;
}

export async function setBuzzer(
  credentials: DeviceCredentials,
  args: z.infer<typeof SET_BUZZER_SCHEMA>,
) {
  const response = await runCommand(`${MODEL}.buzzer`, credentials, args);
  const state = parseState(HUMIDIFIER_STATE, response);
  confirm(state.buzzer === args.buzzer);
  return state;
}

export async function setConstantProtection(
  credentials: DeviceCredentials,
  args: z.infer<typeof SET_CONSTANT_PROTECTION_SCHEMA>,
) {
  const response = await runCommand(`${MODEL}.constantProtection`, credentials, args);
  const state = parseState(HUMIDIFIER_STATE, response);
  confirm(state.constantProtection === args.constantProtection);
  return state;
}

export async function setIndicator(
  credentials: DeviceCredentials,
  args: z.infer<typeof SET_INDICATOR_SCHEMA>,
) {
  const response = await runCommand(`${MODEL}.indicator`, credentials, args);
  const state = parseState(HUMIDIFIER_STATE, response);
  confirm(state.indicator === args.indicator);
  return state;
}

export async function setLevel(
  credentials: DeviceCredentials,
  args: z.infer<typeof SET_LEVEL_SCHEMA>,
) {
  const response = await runCommand(`${MODEL}.level`, credentials, args);
  const state = parseState(HUMIDIFIER_STATE, response);
  confirm(state.level === args.level);
  return state;
}

export async function setOverwetProtection(
  credentials: DeviceCredentials,
  args: z.infer<typeof SET_OVERWET_PROTECTION_SCHEMA>,
) {
  const response = await runCommand(`${MODEL}.overwetProtection`, credentials, args);
  const state = parseState(HUMIDIFIER_STATE, response);
  confirm(state.overwetProtection === args.overwetProtection);
  return state;
}

export async function setTargetHumidity(
  credentials: DeviceCredentials,
  args: z.infer<typeof SET_TARGET_HUMIDITY_SCHEMA>,
) {
  const response = await runCommand(`${MODEL}.targetHumidity`, credentials, args);
  const state = parseState(HUMIDIFIER_STATE, response);
  confirm(state.targetHumidity === args.targetHumidity);
  return state;
}
