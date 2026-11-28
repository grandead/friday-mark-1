import { z } from 'zod';
import { type DeviceCredentials, runCommand } from '../drivers/miio';
import { confirm, parseState } from '../utils';

export const GET_STATE_SCHEMA = z.strictObject({});

const QINGPING_STATE = z.strictObject({
  humidity: z.number().min(0).max(100),
  temperature: z.number().min(-30).max(100),
  co2: z.number().min(0).max(9999),
  pm25: z.number().min(0).max(1000),
  pm10: z.number().min(0).max(1000),
  battery: z.number().min(0).max(100).optional(),
  chargingState: z.number().int().min(0).max(3).optional(),
  voltage: z.number().nonnegative().optional(),
  monitoringInterval: z.number().int().min(0).max(600).optional(),
  screenOffDelay: z.number().int().min(0).max(600).optional(),
  powerOffDelay: z.number().int().min(0).max(60).optional(),
  temperatureUnit: z.enum(['c', 'f']).optional(),
  screensaverDelay: z.number().int().min(0).max(1800).optional(),
  autoSlideInterval: z.number().int().min(0).max(3600).optional(),
  twelveHourClock: z.boolean().optional(),
  powerOffSeconds: z.number().int().min(0).max(65535).optional(),
  pm25Standard: z.enum(['cn', 'us']).optional(),
});

export type QingpingState = z.infer<typeof QINGPING_STATE>;

export const SET_AUTO_SLIDE_INTERVAL_SCHEMA = z.strictObject({
  autoSlideInterval: z.number().int().min(0).max(3600),
});

export const SET_MONITORING_INTERVAL_SCHEMA = z.strictObject({
  monitoringInterval: z.literal([0, 1, 60, 300, 600]),
});

export const SET_PM25_STANDARD_SCHEMA = z.strictObject({
  pm25Standard: z.enum(['cn', 'us']),
});

export const SET_POWER_OFF_DELAY_SCHEMA = z.strictObject({
  powerOffDelay: z.literal([0, 10, 15, 30, 60]),
});

export const SET_POWER_OFF_SECONDS_SCHEMA = z.strictObject({
  powerOffSeconds: z.number().int().min(0).max(65535),
});

export const SET_SCREEN_OFF_DELAY_SCHEMA = z.strictObject({
  screenOffDelay: z.literal([0, 15, 30, 60, 300, 600]),
});

export const SET_SCREENSAVER_DELAY_SCHEMA = z.strictObject({
  screensaverDelay: z.number().int().min(0).max(1800),
});

export const SET_TEMPERATURE_UNIT_SCHEMA = z.strictObject({
  temperatureUnit: z.enum(['c', 'f']),
});

export const SET_TWELVE_HOUR_CLOCK_SCHEMA = z.strictObject({
  twelveHourClock: z.boolean(),
});

export async function getState(
  credentials: DeviceCredentials,
  args: z.infer<typeof GET_STATE_SCHEMA>,
): Promise<QingpingState> {
  const response = await runCommand('qingping-air-monitor-lite.state', credentials, args);
  return parseState(QINGPING_STATE, response);
}

export async function setAutoSlideInterval(
  credentials: DeviceCredentials,
  args: z.infer<typeof SET_AUTO_SLIDE_INTERVAL_SCHEMA>,
) {
  const response = await runCommand(
    'qingping-air-monitor-lite.autoSlideInterval',
    credentials,
    args,
  );
  const state = parseState(QINGPING_STATE, response);
  confirm(state.autoSlideInterval === args.autoSlideInterval);
  return state;
}

export async function setMonitoringInterval(
  credentials: DeviceCredentials,
  args: z.infer<typeof SET_MONITORING_INTERVAL_SCHEMA>,
) {
  const response = await runCommand(
    'qingping-air-monitor-lite.monitoringInterval',
    credentials,
    args,
  );
  const state = parseState(QINGPING_STATE, response);
  confirm(state.monitoringInterval === args.monitoringInterval);
  return state;
}

export async function setPm25Standard(
  credentials: DeviceCredentials,
  args: z.infer<typeof SET_PM25_STANDARD_SCHEMA>,
) {
  const response = await runCommand('qingping-air-monitor-lite.pm25Standard', credentials, args);
  const state = parseState(QINGPING_STATE, response);
  confirm(state.pm25Standard === args.pm25Standard);
  return state;
}

export async function setPowerOffDelay(
  credentials: DeviceCredentials,
  args: z.infer<typeof SET_POWER_OFF_DELAY_SCHEMA>,
) {
  const response = await runCommand('qingping-air-monitor-lite.powerOffDelay', credentials, args);
  const state = parseState(QINGPING_STATE, response);
  confirm(state.powerOffDelay === args.powerOffDelay);
  return state;
}

export async function setPowerOffSeconds(
  credentials: DeviceCredentials,
  args: z.infer<typeof SET_POWER_OFF_SECONDS_SCHEMA>,
) {
  const response = await runCommand('qingping-air-monitor-lite.powerOffSeconds', credentials, args);
  const state = parseState(QINGPING_STATE, response);
  confirm(state.powerOffSeconds === args.powerOffSeconds);
  return state;
}

export async function setScreenOffDelay(
  credentials: DeviceCredentials,
  args: z.infer<typeof SET_SCREEN_OFF_DELAY_SCHEMA>,
) {
  const response = await runCommand('qingping-air-monitor-lite.screenOffDelay', credentials, args);
  const state = parseState(QINGPING_STATE, response);
  confirm(state.screenOffDelay === args.screenOffDelay);
  return state;
}

export async function setScreensaverDelay(
  credentials: DeviceCredentials,
  args: z.infer<typeof SET_SCREENSAVER_DELAY_SCHEMA>,
) {
  const response = await runCommand(
    'qingping-air-monitor-lite.screensaverDelay',
    credentials,
    args,
  );
  const state = parseState(QINGPING_STATE, response);
  confirm(state.screensaverDelay === args.screensaverDelay);
  return state;
}

export async function setTemperatureUnit(
  credentials: DeviceCredentials,
  args: z.infer<typeof SET_TEMPERATURE_UNIT_SCHEMA>,
) {
  const response = await runCommand('qingping-air-monitor-lite.temperatureUnit', credentials, args);
  const state = parseState(QINGPING_STATE, response);
  confirm(state.temperatureUnit === args.temperatureUnit);
  return state;
}

export async function setTwelveHourClock(
  credentials: DeviceCredentials,
  args: z.infer<typeof SET_TWELVE_HOUR_CLOCK_SCHEMA>,
) {
  const response = await runCommand('qingping-air-monitor-lite.twelveHourClock', credentials, args);
  const state = parseState(QINGPING_STATE, response);
  confirm(state.twelveHourClock === args.twelveHourClock);
  return state;
}
