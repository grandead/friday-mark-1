import { z } from 'zod';
import type { DeviceConnection, DeviceModel } from '../common';
import {
  confirm,
  DEVICE_ID_SCHEMA,
  HUMIDITY,
  joinDescription,
  POWER_ARGUMENTS,
  powerDescription,
  runDeviceOperation,
  STATE_ARGUMENTS,
  TEMPERATURE,
} from '../common';

const BALLU_MODES = ['manual', 'night', 'turbo', 'eco'] as const;
const BALLU_SOUNDS = ['off', 'rain', 'sea', 'forest', 'birds', 'fireplace'] as const;
const MODE_NAMES = {
  off: 'выключен',
  manual: 'ручной',
  auto: 'автоматический',
  night: 'ночной',
  turbo: 'турбо',
  eco: 'экопроветривание',
};
const SOUND_NAMES = {
  off: 'выключен',
  rain: 'дождь',
  sea: 'море',
  forest: 'лес',
  birds: 'птицы',
  fireplace: 'камин',
};

const BALLU_STATE_FIELDS = {
  power: z.boolean(),
  mode: z.enum(['off', 'auto', ...BALLU_MODES]).optional(),
  speed: z.number().int().min(0).max(8).optional(),
  targetTemperature: z.number().min(0).max(25).optional(),
  heaterInstalled: z.boolean().optional(),
  co2SensorInstalled: z.boolean().optional(),
  buttonSound: z.boolean().optional(),
  backlightAutoOff: z.boolean().optional(),
  sound: z.enum(BALLU_SOUNDS).optional(),
  filterCounter: z.number().int().nonnegative().max(65535).optional(),
  errorCode: z.number().int().nonnegative().optional(),
  turboSeconds: z.number().int().nonnegative().optional(),
  humidity: HUMIDITY,
  temperature: TEMPERATURE,
  co2: z.number().nonnegative().optional(),
  pm25: z.number().nonnegative().optional(),
};
const BALLU_STATE = z.strictObject(BALLU_STATE_FIELDS);

const MODE_FIELDS = { deviceId: DEVICE_ID_SCHEMA, mode: z.enum(BALLU_MODES) };
const MODE_ARGUMENTS = z.strictObject(MODE_FIELDS);
const SPEED_FIELDS = {
  deviceId: DEVICE_ID_SCHEMA,
  speed: z.number().int().min(1).max(7),
};
const SPEED_ARGUMENTS = z.strictObject(SPEED_FIELDS);
const TEMPERATURE_FIELDS = {
  deviceId: DEVICE_ID_SCHEMA,
  temperature: z.number().int().min(5).max(25),
};
const TEMPERATURE_ARGUMENTS = z.strictObject(TEMPERATURE_FIELDS);
const ENABLED_FIELDS = { deviceId: DEVICE_ID_SCHEMA, enabled: z.boolean() };
const ENABLED_ARGUMENTS = z.strictObject(ENABLED_FIELDS);
const SOUND_FIELDS = { deviceId: DEVICE_ID_SCHEMA, sound: z.enum(BALLU_SOUNDS) };
const SOUND_ARGUMENTS = z.strictObject(SOUND_FIELDS);
export const BALLU_ASP100 = {
  code: 'ballu-oneair-asp-100',
  transport: 'syncleo',
  operations: {
    state: { schema: STATE_ARGUMENTS, execute: getState },
    power: { schema: POWER_ARGUMENTS, execute: setPower },
    mode: { schema: MODE_ARGUMENTS, execute: setMode },
    speed: { schema: SPEED_ARGUMENTS, execute: setSpeed },
    targetTemperature: { schema: TEMPERATURE_ARGUMENTS, execute: setTemperature },
    buttonSound: { schema: ENABLED_ARGUMENTS, execute: setButtonSound },
    backlightAutoOff: { schema: ENABLED_ARGUMENTS, execute: setBacklightAutoOff },
    sound: { schema: SOUND_ARGUMENTS, execute: setSound },
    resetFilter: { schema: STATE_ARGUMENTS, execute: resetFilter },
  },
} satisfies DeviceModel;

async function getState(_args: z.infer<typeof STATE_ARGUMENTS>, connection: DeviceConnection) {
  const parameters = {};
  const state = await runDeviceOperation(connection, 'state', parameters, BALLU_STATE);
  const description = describeBalluState(state);
  return { state, description };
}

async function setPower(args: z.infer<typeof POWER_ARGUMENTS>, connection: DeviceConnection) {
  const parameters = { power: args.power };
  const state = await runDeviceOperation(connection, 'power', parameters, BALLU_STATE);
  confirm(state.power === args.power);
  const description = powerDescription(state);
  return { state, description };
}

async function setMode(args: z.infer<typeof MODE_ARGUMENTS>, connection: DeviceConnection) {
  const parameters = { mode: args.mode };
  const state = await runDeviceOperation(connection, 'mode', parameters, BALLU_STATE);
  confirm(state.mode === args.mode && state.power);
  const description = `режим ${MODE_NAMES[args.mode]}${args.mode === 'turbo' ? ' на 15 минут' : ''}.`;
  return { state, description };
}

async function setSpeed(args: z.infer<typeof SPEED_ARGUMENTS>, connection: DeviceConnection) {
  const parameters = { speed: args.speed };
  const state = await runDeviceOperation(connection, 'speed', parameters, BALLU_STATE);
  confirm(state.speed === args.speed && state.mode === 'manual' && state.power);
  const description = `скорость ${args.speed}, ручной режим.`;
  return { state, description };
}

async function setTemperature(
  args: z.infer<typeof TEMPERATURE_ARGUMENTS>,
  connection: DeviceConnection,
) {
  const parameters = { temperature: args.temperature };
  const state = await runDeviceOperation(connection, 'targetTemperature', parameters, BALLU_STATE);
  confirm(state.targetTemperature === args.temperature && state.heaterInstalled === true);
  const description = `задана температура приточного воздуха ${args.temperature} градусов.`;
  return { state, description };
}

async function setButtonSound(
  args: z.infer<typeof ENABLED_ARGUMENTS>,
  connection: DeviceConnection,
) {
  const parameters = { enabled: args.enabled };
  const state = await runDeviceOperation(connection, 'buttonSound', parameters, BALLU_STATE);
  confirm(state.buttonSound === args.enabled);
  const description = `звуки кнопок ${args.enabled ? 'включены' : 'выключены'}.`;
  return { state, description };
}

async function setBacklightAutoOff(
  args: z.infer<typeof ENABLED_ARGUMENTS>,
  connection: DeviceConnection,
) {
  const parameters = { enabled: args.enabled };
  const state = await runDeviceOperation(connection, 'backlightAutoOff', parameters, BALLU_STATE);
  confirm(state.backlightAutoOff === args.enabled);
  const description = `автоматическое гашение подсветки ${args.enabled ? 'включено' : 'выключено'}.`;
  return { state, description };
}

async function setSound(args: z.infer<typeof SOUND_ARGUMENTS>, connection: DeviceConnection) {
  const parameters = { sound: args.sound };
  const state = await runDeviceOperation(connection, 'sound', parameters, BALLU_STATE);
  confirm(state.sound === args.sound);
  const description =
    args.sound === 'off' ? 'фоновый звук выключен.' : `фоновый звук — ${SOUND_NAMES[args.sound]}.`;
  return { state, description };
}

async function resetFilter(_args: z.infer<typeof STATE_ARGUMENTS>, connection: DeviceConnection) {
  const parameters = {};
  const state = await runDeviceOperation(connection, 'resetFilter', parameters, BALLU_STATE);
  confirm(state.filterCounter === 0);
  const description = 'счётчик основного фильтра сброшен.';
  return { state, description };
}

export type BalluState = z.infer<typeof BALLU_STATE>;
function describeBalluState(state: BalluState) {
  // Installed ASP-100 units have no CO2 sensor, including when capability data is absent.
  const parts = [
    powerDescription(state),
    !state.mode || state.mode === 'off' ? undefined : `Режим ${MODE_NAMES[state.mode]}.`,
    state.speed === undefined ? undefined : `Скорость ${state.speed}.`,
    state.targetTemperature === undefined
      ? undefined
      : `Задано ${state.targetTemperature} градусов для приточного воздуха.`,
    state.turboSeconds === undefined || state.mode !== 'turbo'
      ? undefined
      : `До конца турборежима ${state.turboSeconds} секунд.`,
    state.filterCounter === undefined
      ? undefined
      : `Показатель счётчика фильтра ${state.filterCounter}.`,
    state.errorCode === undefined
      ? undefined
      : state.errorCode === 0
        ? 'Ошибок нет.'
        : `Код ошибки ${state.errorCode}.`,
    state.buttonSound === undefined
      ? undefined
      : `Звуки кнопок ${state.buttonSound ? 'включены' : 'выключены'}.`,
    state.backlightAutoOff === undefined
      ? undefined
      : `Автогашение подсветки ${state.backlightAutoOff ? 'включено' : 'выключено'}.`,
    state.sound === undefined ? undefined : `Фоновый звук: ${SOUND_NAMES[state.sound]}.`,
    state.humidity === undefined ? undefined : `Влажность ${state.humidity} процентов.`,
    state.temperature === undefined
      ? undefined
      : `Температура приточного воздуха ${state.temperature} градусов.`,
    state.pm25 === undefined ? undefined : `PM2.5 ${state.pm25} микрограммов на кубометр.`,
  ];
  return joinDescription(parts);
}
