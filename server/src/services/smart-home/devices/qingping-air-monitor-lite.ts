import { z } from 'zod';
import type { DeviceConnection, DeviceModel } from '../common';
import {
  confirm,
  DEVICE_ID_SCHEMA,
  HUMIDITY,
  joinDescription,
  runDeviceOperation,
  STATE_ARGUMENTS,
} from '../common';

const CHARGING_NAMES: Record<number, string> = {
  0: 'без внешнего питания',
  1: 'заряжается',
  2: 'не заряжается',
  3: 'зарядка недоступна',
};
const STATE_FIELDS = {
  humidity: z.number().min(0).max(100),
  temperature: z.number().min(-30).max(100),
  co2: z.number().min(0).max(9999),
  pm25: z.number().min(0).max(1000),
  pm10: z.number().min(0).max(1000),
  battery: HUMIDITY,
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
};
const STATE_SCHEMA = z.strictObject(STATE_FIELDS);
const MONITORING_INTERVAL_OPTIONS = [
  z.literal(0),
  z.literal(1),
  z.literal(60),
  z.literal(300),
  z.literal(600),
] as const;
const MONITORING_INTERVAL_FIELDS = {
  deviceId: DEVICE_ID_SCHEMA,
  monitoringInterval: z.union(MONITORING_INTERVAL_OPTIONS),
};
const MONITORING_INTERVAL_ARGUMENTS = z.strictObject(MONITORING_INTERVAL_FIELDS);
const POWER_OFF_SECONDS_FIELDS = {
  deviceId: DEVICE_ID_SCHEMA,
  powerOffSeconds: z.number().int().min(0).max(65535),
};
const POWER_OFF_SECONDS_ARGUMENTS = z.strictObject(POWER_OFF_SECONDS_FIELDS);
const PM25_STANDARD_FIELDS = {
  deviceId: DEVICE_ID_SCHEMA,
  pm25Standard: z.enum(['cn', 'us']),
};
const PM25_STANDARD_ARGUMENTS = z.strictObject(PM25_STANDARD_FIELDS);
const SCREEN_OFF_DELAY_OPTIONS = [
  z.literal(0),
  z.literal(15),
  z.literal(30),
  z.literal(60),
  z.literal(300),
  z.literal(600),
] as const;
const SCREEN_OFF_DELAY_FIELDS = {
  deviceId: DEVICE_ID_SCHEMA,
  screenOffDelay: z.union(SCREEN_OFF_DELAY_OPTIONS),
};
const SCREEN_OFF_DELAY_ARGUMENTS = z.strictObject(SCREEN_OFF_DELAY_FIELDS);
const POWER_OFF_DELAY_OPTIONS = [
  z.literal(0),
  z.literal(10),
  z.literal(15),
  z.literal(30),
  z.literal(60),
] as const;
const POWER_OFF_DELAY_FIELDS = {
  deviceId: DEVICE_ID_SCHEMA,
  powerOffDelay: z.union(POWER_OFF_DELAY_OPTIONS),
};
const POWER_OFF_DELAY_ARGUMENTS = z.strictObject(POWER_OFF_DELAY_FIELDS);
const TEMPERATURE_UNIT_FIELDS = {
  deviceId: DEVICE_ID_SCHEMA,
  temperatureUnit: z.enum(['c', 'f']),
};
const TEMPERATURE_UNIT_ARGUMENTS = z.strictObject(TEMPERATURE_UNIT_FIELDS);
const SCREENSAVER_DELAY_FIELDS = {
  deviceId: DEVICE_ID_SCHEMA,
  screensaverDelay: z.number().int().min(0).max(1800),
};
const SCREENSAVER_DELAY_ARGUMENTS = z.strictObject(SCREENSAVER_DELAY_FIELDS);
const AUTO_SLIDE_INTERVAL_FIELDS = {
  deviceId: DEVICE_ID_SCHEMA,
  autoSlideInterval: z.number().int().min(0).max(3600),
};
const AUTO_SLIDE_INTERVAL_ARGUMENTS = z.strictObject(AUTO_SLIDE_INTERVAL_FIELDS);
const CLOCK_FORMAT_FIELDS = {
  deviceId: DEVICE_ID_SCHEMA,
  twelveHourClock: z.boolean(),
};
const CLOCK_FORMAT_ARGUMENTS = z.strictObject(CLOCK_FORMAT_FIELDS);
export const QINGPING_AIR_MONITOR_LITE = {
  code: 'qingping-air-monitor-lite',
  transport: 'miio',
  operations: {
    state: { schema: STATE_ARGUMENTS, execute: getState },
    powerOffSeconds: { schema: POWER_OFF_SECONDS_ARGUMENTS, execute: setPowerOffSeconds },
    pm25Standard: { schema: PM25_STANDARD_ARGUMENTS, execute: setPm25Standard },
    monitoringInterval: { schema: MONITORING_INTERVAL_ARGUMENTS, execute: setMonitoringInterval },
    screenOffDelay: { schema: SCREEN_OFF_DELAY_ARGUMENTS, execute: setScreenOffDelay },
    powerOffDelay: { schema: POWER_OFF_DELAY_ARGUMENTS, execute: setPowerOffDelay },
    temperatureUnit: { schema: TEMPERATURE_UNIT_ARGUMENTS, execute: setTemperatureUnit },
    screensaverDelay: { schema: SCREENSAVER_DELAY_ARGUMENTS, execute: setScreensaverDelay },
    autoSlideInterval: { schema: AUTO_SLIDE_INTERVAL_ARGUMENTS, execute: setAutoSlideInterval },
    twelveHourClock: { schema: CLOCK_FORMAT_ARGUMENTS, execute: setTwelveHourClock },
  },
} satisfies DeviceModel;

async function setPowerOffSeconds(
  args: z.infer<typeof POWER_OFF_SECONDS_ARGUMENTS>,
  connection: DeviceConnection,
) {
  const parameters = { powerOffSeconds: args.powerOffSeconds };
  const state = await runDeviceOperation(connection, 'powerOffSeconds', parameters, STATE_SCHEMA);
  confirm(state.powerOffSeconds === args.powerOffSeconds);
  const description =
    args.powerOffSeconds === 0
      ? 'Автовыключение прибора отключено.'
      : `Прибор будет выключаться через ${args.powerOffSeconds} секунд.`;
  return { state, description };
}
async function setPm25Standard(
  args: z.infer<typeof PM25_STANDARD_ARGUMENTS>,
  connection: DeviceConnection,
) {
  const parameters = { pm25Standard: args.pm25Standard };
  const state = await runDeviceOperation(connection, 'pm25Standard', parameters, STATE_SCHEMA);
  confirm(state.pm25Standard === args.pm25Standard);
  const description = `Стандарт оценки PM2.5: ${args.pm25Standard === 'cn' ? 'китайский' : 'американский'}.`;
  return { state, description };
}

async function getState(_args: z.infer<typeof STATE_ARGUMENTS>, connection: DeviceConnection) {
  const state = await runDeviceOperation(connection, 'state', {}, STATE_SCHEMA);
  const description = describeState(state);
  return { state, description };
}
async function setMonitoringInterval(
  args: z.infer<typeof MONITORING_INTERVAL_ARGUMENTS>,
  connection: DeviceConnection,
) {
  const parameters = { monitoringInterval: args.monitoringInterval };
  const state = await runDeviceOperation(
    connection,
    'monitoringInterval',
    parameters,
    STATE_SCHEMA,
  );
  confirm(state.monitoringInterval === args.monitoringInterval);
  const description = `Интервал измерений: ${args.monitoringInterval} секунд.`;
  return { state, description };
}
async function setScreenOffDelay(
  args: z.infer<typeof SCREEN_OFF_DELAY_ARGUMENTS>,
  connection: DeviceConnection,
) {
  const parameters = { screenOffDelay: args.screenOffDelay };
  const state = await runDeviceOperation(connection, 'screenOffDelay', parameters, STATE_SCHEMA);
  confirm(state.screenOffDelay === args.screenOffDelay);
  const description =
    args.screenOffDelay === 0
      ? 'Автовыключение экрана отключено.'
      : `Экран будет выключаться через ${args.screenOffDelay} секунд.`;
  return { state, description };
}
async function setPowerOffDelay(
  args: z.infer<typeof POWER_OFF_DELAY_ARGUMENTS>,
  connection: DeviceConnection,
) {
  const parameters = { powerOffDelay: args.powerOffDelay };
  const state = await runDeviceOperation(connection, 'powerOffDelay', parameters, STATE_SCHEMA);
  confirm(state.powerOffDelay === args.powerOffDelay);
  const description =
    args.powerOffDelay === 0
      ? 'Автовыключение прибора отключено.'
      : `Прибор будет выключаться через ${args.powerOffDelay} минут.`;
  return { state, description };
}
async function setTemperatureUnit(
  args: z.infer<typeof TEMPERATURE_UNIT_ARGUMENTS>,
  connection: DeviceConnection,
) {
  const parameters = { temperatureUnit: args.temperatureUnit };
  const state = await runDeviceOperation(connection, 'temperatureUnit', parameters, STATE_SCHEMA);
  confirm(state.temperatureUnit === args.temperatureUnit);
  const description = `На экране: градусы ${args.temperatureUnit === 'c' ? 'Цельсия' : 'Фаренгейта'}.`;
  return { state, description };
}
async function setScreensaverDelay(
  args: z.infer<typeof SCREENSAVER_DELAY_ARGUMENTS>,
  connection: DeviceConnection,
) {
  const parameters = { screensaverDelay: args.screensaverDelay };
  const state = await runDeviceOperation(connection, 'screensaverDelay', parameters, STATE_SCHEMA);
  confirm(state.screensaverDelay === args.screensaverDelay);
  const description = `Задержка заставки ${args.screensaverDelay} секунд.`;
  return { state, description };
}
async function setAutoSlideInterval(
  args: z.infer<typeof AUTO_SLIDE_INTERVAL_ARGUMENTS>,
  connection: DeviceConnection,
) {
  const parameters = { autoSlideInterval: args.autoSlideInterval };
  const state = await runDeviceOperation(connection, 'autoSlideInterval', parameters, STATE_SCHEMA);
  confirm(state.autoSlideInterval === args.autoSlideInterval);
  const description =
    args.autoSlideInterval === 0
      ? 'Автоперелистывание отключено.'
      : `Автоперелистывание каждые ${args.autoSlideInterval} секунд.`;
  return { state, description };
}
async function setTwelveHourClock(
  args: z.infer<typeof CLOCK_FORMAT_ARGUMENTS>,
  connection: DeviceConnection,
) {
  const parameters = { twelveHourClock: args.twelveHourClock };
  const state = await runDeviceOperation(connection, 'twelveHourClock', parameters, STATE_SCHEMA);
  confirm(state.twelveHourClock === args.twelveHourClock);
  const description = `Формат часов: ${args.twelveHourClock ? 12 : 24} часа.`;
  return { state, description };
}

function describeState(state: z.infer<typeof STATE_SCHEMA>) {
  const temperature = Math.round(state.temperature * 10) / 10;
  const parts = [
    state.powerOffSeconds === undefined
      ? undefined
      : state.powerOffSeconds === 0
        ? 'Точный таймер выключения отключён.'
        : `Точный таймер выключения: ${state.powerOffSeconds} секунд.`,
    state.pm25Standard === undefined
      ? undefined
      : `Стандарт оценки PM2.5: ${state.pm25Standard === 'cn' ? 'китайский' : 'американский'}.`,
    `CO2 ${state.co2} ppm.`,
    `PM2.5 ${state.pm25}, PM10 ${state.pm10} микрограммов на кубометр.`,
    `Температура ${temperature} градусов Цельсия.`,
    `Влажность ${state.humidity} процентов.`,
    state.battery === undefined ? undefined : `Заряд ${state.battery} процентов.`,
    state.chargingState === undefined
      ? undefined
      : `Питание: ${CHARGING_NAMES[state.chargingState]}.`,
    state.voltage === undefined
      ? undefined
      : `Напряжение аккумулятора ${state.voltage} милливольт.`,
    state.monitoringInterval === undefined
      ? undefined
      : `Интервал измерений ${state.monitoringInterval} секунд.`,
    state.screenOffDelay === undefined
      ? undefined
      : state.screenOffDelay === 0
        ? 'Автовыключение экрана отключено.'
        : `Автовыключение экрана через ${state.screenOffDelay} секунд.`,
    state.powerOffDelay === undefined
      ? undefined
      : state.powerOffDelay === 0
        ? 'Автовыключение прибора отключено.'
        : `Автовыключение прибора через ${state.powerOffDelay} минут.`,
    state.temperatureUnit === undefined
      ? undefined
      : `Единицы на экране: ${state.temperatureUnit === 'c' ? 'Цельсий' : 'Фаренгейт'}.`,
    state.screensaverDelay === undefined
      ? undefined
      : `Задержка заставки ${state.screensaverDelay} секунд.`,
    state.autoSlideInterval === undefined
      ? undefined
      : `Интервал автоперелистывания ${state.autoSlideInterval} секунд.`,
    state.twelveHourClock === undefined
      ? undefined
      : `Формат часов ${state.twelveHourClock ? 12 : 24} часа.`,
  ];
  return joinDescription(parts);
}
