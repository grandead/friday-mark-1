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

const MODE_NAMES = { manual: 'ручной', constantHumidity: 'поддержание влажности' };
const FAULT_NAMES = {
  none: 'нет ошибок',
  waterShortage: 'недостаточно воды',
  tankSeparated: 'бак отделён',
};
const STATE_FIELDS = {
  power: z.boolean(),
  humidity: HUMIDITY,
  temperature: TEMPERATURE,
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
};
const STATE_SCHEMA = z.strictObject(STATE_FIELDS);
const LEVEL_FIELDS = {
  deviceId: DEVICE_ID_SCHEMA,
  level: z.number().int().min(1).max(4),
};
const LEVEL_ARGUMENTS = z.strictObject(LEVEL_FIELDS);
const MODE_FIELDS = {
  deviceId: DEVICE_ID_SCHEMA,
  mode: z.enum(['manual', 'constantHumidity']),
};
const MODE_ARGUMENTS = z.strictObject(MODE_FIELDS);
const TARGET_HUMIDITY_FIELDS = {
  deviceId: DEVICE_ID_SCHEMA,
  targetHumidity: z.number().int().min(40).max(70),
};
const TARGET_HUMIDITY_ARGUMENTS = z.strictObject(TARGET_HUMIDITY_FIELDS);
const BUZZER_FIELDS = { deviceId: DEVICE_ID_SCHEMA, buzzer: z.boolean() };
const BUZZER_ARGUMENTS = z.strictObject(BUZZER_FIELDS);
const INDICATOR_FIELDS = { deviceId: DEVICE_ID_SCHEMA, indicator: z.boolean() };
const INDICATOR_ARGUMENTS = z.strictObject(INDICATOR_FIELDS);
const OVERWET_PROTECTION_FIELDS = {
  deviceId: DEVICE_ID_SCHEMA,
  overwetProtection: z.boolean(),
};
const OVERWET_PROTECTION_ARGUMENTS = z.strictObject(OVERWET_PROTECTION_FIELDS);
const CONSTANT_PROTECTION_FIELDS = {
  deviceId: DEVICE_ID_SCHEMA,
  constantProtection: z.boolean(),
};
const CONSTANT_PROTECTION_ARGUMENTS = z.strictObject(CONSTANT_PROTECTION_FIELDS);
export const SMART_HUMIDIFIER_2 = {
  code: 'xiaomi-smart-humidifier-2',
  transport: 'miio',
  operations: {
    state: { schema: STATE_ARGUMENTS, execute: getState },
    power: { schema: POWER_ARGUMENTS, execute: setPower },
    level: { schema: LEVEL_ARGUMENTS, execute: setLevel },
    mode: { schema: MODE_ARGUMENTS, execute: setMode },
    targetHumidity: { schema: TARGET_HUMIDITY_ARGUMENTS, execute: setTargetHumidity },
    buzzer: { schema: BUZZER_ARGUMENTS, execute: setBuzzer },
    indicator: { schema: INDICATOR_ARGUMENTS, execute: setIndicator },
    overwetProtection: { schema: OVERWET_PROTECTION_ARGUMENTS, execute: setOverwetProtection },
    constantProtection: { schema: CONSTANT_PROTECTION_ARGUMENTS, execute: setConstantProtection },
  },
} satisfies DeviceModel;

async function getState(_args: z.infer<typeof STATE_ARGUMENTS>, connection: DeviceConnection) {
  const state = await runDeviceOperation(connection, 'state', {}, STATE_SCHEMA);
  const description = describeState(state);
  return { state, description };
}
async function setPower(args: z.infer<typeof POWER_ARGUMENTS>, connection: DeviceConnection) {
  const parameters = { power: args.power };
  const state = await runDeviceOperation(connection, 'power', parameters, STATE_SCHEMA);
  confirm(state.power === args.power);
  const description = powerDescription(state);
  return { state, description };
}
async function setLevel(args: z.infer<typeof LEVEL_ARGUMENTS>, connection: DeviceConnection) {
  const parameters = { level: args.level };
  const state = await runDeviceOperation(connection, 'level', parameters, STATE_SCHEMA);
  confirm(state.level === args.level);
  const description =
    args.level === 4 ? 'Выбрано поддержание влажности.' : `Уровень увлажнения ${args.level}.`;
  return { state, description };
}
async function setMode(args: z.infer<typeof MODE_ARGUMENTS>, connection: DeviceConnection) {
  const parameters = { mode: args.mode };
  const state = await runDeviceOperation(connection, 'mode', parameters, STATE_SCHEMA);
  confirm(state.mode === args.mode);
  const description = `Режим: ${MODE_NAMES[args.mode]}.`;
  return { state, description };
}
async function setTargetHumidity(
  args: z.infer<typeof TARGET_HUMIDITY_ARGUMENTS>,
  connection: DeviceConnection,
) {
  const parameters = { targetHumidity: args.targetHumidity };
  const state = await runDeviceOperation(connection, 'targetHumidity', parameters, STATE_SCHEMA);
  confirm(state.targetHumidity === args.targetHumidity);
  const description = `Целевая влажность ${args.targetHumidity} процентов.`;
  return { state, description };
}
async function setBuzzer(args: z.infer<typeof BUZZER_ARGUMENTS>, connection: DeviceConnection) {
  const parameters = { buzzer: args.buzzer };
  const state = await runDeviceOperation(connection, 'buzzer', parameters, STATE_SCHEMA);
  confirm(state.buzzer === args.buzzer);
  const description = `Звуковые сигналы ${args.buzzer ? 'включены' : 'выключены'}.`;
  return { state, description };
}
async function setIndicator(
  args: z.infer<typeof INDICATOR_ARGUMENTS>,
  connection: DeviceConnection,
) {
  const parameters = { indicator: args.indicator };
  const state = await runDeviceOperation(connection, 'indicator', parameters, STATE_SCHEMA);
  confirm(state.indicator === args.indicator);
  const description = `Индикаторы ${args.indicator ? 'включены' : 'выключены'}.`;
  return { state, description };
}
async function setOverwetProtection(
  args: z.infer<typeof OVERWET_PROTECTION_ARGUMENTS>,
  connection: DeviceConnection,
) {
  const parameters = { overwetProtection: args.overwetProtection };
  const state = await runDeviceOperation(connection, 'overwetProtection', parameters, STATE_SCHEMA);
  confirm(state.overwetProtection === args.overwetProtection);
  const description = `Защита от избыточной влажности ${args.overwetProtection ? 'включена' : 'выключена'}.`;
  return { state, description };
}
async function setConstantProtection(
  args: z.infer<typeof CONSTANT_PROTECTION_ARGUMENTS>,
  connection: DeviceConnection,
) {
  const parameters = { constantProtection: args.constantProtection };
  const state = await runDeviceOperation(
    connection,
    'constantProtection',
    parameters,
    STATE_SCHEMA,
  );
  confirm(state.constantProtection === args.constantProtection);
  const description = `Защита в режиме постоянной влажности ${args.constantProtection ? 'включена' : 'выключена'}.`;
  return { state, description };
}

function describeState(state: z.infer<typeof STATE_SCHEMA>) {
  const parts = [
    powerDescription(state),
    state.humidity === undefined ? undefined : `Влажность ${state.humidity} процентов.`,
    state.temperature === undefined ? undefined : `Температура ${state.temperature} градусов.`,
    state.mode === undefined ? undefined : `Режим: ${MODE_NAMES[state.mode]}.`,
    state.level === undefined
      ? undefined
      : state.level === 4
        ? 'Выбрано поддержание влажности.'
        : `Уровень увлажнения ${state.level}.`,
    state.targetHumidity === undefined
      ? undefined
      : `Целевая влажность ${state.targetHumidity} процентов.`,
    state.status === undefined
      ? undefined
      : state.status === 'humidifying'
        ? 'Идёт увлажнение.'
        : 'Ожидание.',
    state.fault === undefined ? undefined : `Диагностика: ${FAULT_NAMES[state.fault]}.`,
    state.buzzer === undefined
      ? undefined
      : `Звуковые сигналы ${state.buzzer ? 'включены' : 'выключены'}.`,
    state.indicator === undefined
      ? undefined
      : `Индикаторы ${state.indicator ? 'включены' : 'выключены'}.`,
    state.tankLifted ? 'Бак снят.' : undefined,
    state.waterShortage ? 'Недостаточно воды.' : undefined,
    state.humiditySensorFault ? 'Ошибка датчика влажности.' : undefined,
    state.temperatureSensorFault ? 'Ошибка датчика температуры.' : undefined,
    state.overwetProtection === undefined
      ? undefined
      : `Защита от избыточной влажности ${state.overwetProtection ? 'включена' : 'выключена'}.`,
    state.constantProtection === undefined
      ? undefined
      : `Защита в режиме постоянной влажности ${state.constantProtection ? 'включена' : 'выключена'}.`,
    state.overwetProtectionActive ? 'Сработала защита от избыточной влажности.' : undefined,
    state.constantProtectionActive ? 'Сработала защита в режиме постоянной влажности.' : undefined,
  ];
  return joinDescription(parts);
}
