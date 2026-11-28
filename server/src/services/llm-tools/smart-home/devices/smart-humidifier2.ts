import type { z } from 'zod';
import { smartHumidifier2 } from '../../../smart-home';

const MODE_NAMES = { manual: 'ручной', constantHumidity: 'поддержание влажности' };
const FAULT_NAMES = {
  none: 'нет ошибок',
  waterShortage: 'недостаточно воды',
  tankSeparated: 'бак отделён',
};

export const SMART_HUMIDIFIER_2 = {
  code: 'xiaomi-smart-humidifier-2',
  tools: [
    {
      name: 'xiaomi_humidifier_get_state',
      description:
        'Прочитать состояние Xiaomi Smart Humidifier 2: влажность, температура, режим, уровень, цель, работа, ошибки, вода, бак, звук, индикаторы и защиты. Не заменяет настройку.',
      schema: smartHumidifier2.GET_STATE_SCHEMA,
      run: smartHumidifier2.getState,
      describe: describeState,
    },
    {
      name: 'xiaomi_humidifier_set_power',
      description:
        'Включить или выключить Xiaomi Smart Humidifier 2 по явной просьбе. Не использовать для отрицаний, цитат или вопросов о возможности действия.',
      schema: smartHumidifier2.SET_POWER_SCHEMA,
      run: smartHumidifier2.setPower,
      describe: (state: smartHumidifier2.HumidifierState) =>
        state.power ? 'включён.' : 'выключен.',
    },
    {
      name: 'xiaomi_humidifier_set_level',
      description:
        'Установить интенсивность Xiaomi Smart Humidifier 2: 1/2/3 — ручные уровни, 4 — поддержание влажности. Четвёртый уровень не является максимальной мощностью.',
      schema: smartHumidifier2.SET_LEVEL_SCHEMA,
      run: smartHumidifier2.setLevel,
      describe: (state: smartHumidifier2.HumidifierState) =>
        state.level === 4 ? 'Выбрано поддержание влажности.' : `Уровень увлажнения ${state.level}.`,
    },
    {
      name: 'xiaomi_humidifier_set_mode',
      description:
        'Режим Xiaomi Smart Humidifier 2: manual — ручной уровень, constantHumidity — поддержание целевой влажности. Цель задаётся отдельной командой.',
      schema: smartHumidifier2.SET_MODE_SCHEMA,
      run: smartHumidifier2.setMode,
      describe: (
        _state: smartHumidifier2.HumidifierState,
        args: z.infer<typeof smartHumidifier2.SET_MODE_SCHEMA>,
      ) => `Режим: ${MODE_NAMES[args.mode]}.`,
    },
    {
      name: 'xiaomi_humidifier_set_target_humidity',
      description:
        'Задать целевую влажность Xiaomi Smart Humidifier 2 от 40 до 70 процентов, шаг 1. Для поддержания цели нужен режим constantHumidity. Не включает прибор и не заменяет отдельный выбор режима.',
      schema: smartHumidifier2.SET_TARGET_HUMIDITY_SCHEMA,
      run: smartHumidifier2.setTargetHumidity,
      describe: (state: smartHumidifier2.HumidifierState) =>
        `Целевая влажность ${state.targetHumidity} процентов.`,
    },
    {
      name: 'xiaomi_humidifier_set_buzzer',
      description: 'Включить или выключить звуковые сигналы Xiaomi Smart Humidifier 2.',
      schema: smartHumidifier2.SET_BUZZER_SCHEMA,
      run: smartHumidifier2.setBuzzer,
      describe: (state: smartHumidifier2.HumidifierState) =>
        `Звуковые сигналы ${state.buzzer ? 'включены' : 'выключены'}.`,
    },
    {
      name: 'xiaomi_humidifier_set_indicator',
      description: 'Включить или выключить индикаторы Xiaomi Smart Humidifier 2.',
      schema: smartHumidifier2.SET_INDICATOR_SCHEMA,
      run: smartHumidifier2.setIndicator,
      describe: (state: smartHumidifier2.HumidifierState) =>
        `Индикаторы ${state.indicator ? 'включены' : 'выключены'}.`,
    },
    {
      name: 'xiaomi_humidifier_set_overwet_protection',
      description:
        'Включить или выключить защиту от избыточной влажности Xiaomi Smart Humidifier 2 по явной просьбе. Не отключает защиту от отсутствия воды.',
      schema: smartHumidifier2.SET_OVERWET_PROTECTION_SCHEMA,
      run: smartHumidifier2.setOverwetProtection,
      describe: (state: smartHumidifier2.HumidifierState) =>
        `Защита от избыточной влажности ${state.overwetProtection ? 'включена' : 'выключена'}.`,
    },
    {
      name: 'xiaomi_humidifier_set_constant_protection',
      description:
        'Включить или выключить защитное отключение в режиме постоянной влажности Xiaomi Smart Humidifier 2 по явной просьбе. Это отдельный параметр защиты, а не переключение режима.',
      schema: smartHumidifier2.SET_CONSTANT_PROTECTION_SCHEMA,
      run: smartHumidifier2.setConstantProtection,
      describe: (state: smartHumidifier2.HumidifierState) =>
        `Защита в режиме постоянной влажности ${state.constantProtection ? 'включена' : 'выключена'}.`,
    },
  ],
} as const;

function describeState(state: smartHumidifier2.HumidifierState) {
  const parts = [
    state.power ? 'включён.' : 'выключен.',
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
  return parts.filter((part) => part !== undefined).join(' ');
}
