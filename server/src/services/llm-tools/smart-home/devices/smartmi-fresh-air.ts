import type { z } from 'zod';
import { smartmiFreshAir } from '../../../smart-home';

const MODE_NAMES = {
  auto: 'автоматический',
  silent: 'ночной',
  interval: 'интервальный',
  low: 'низкая скорость',
  middle: 'средняя скорость',
  strong: 'высокая скорость',
};
const BRIGHTNESS_NAMES = { bright: 'яркий', dim: 'тусклый', off: 'выключен' };

export const SMARTMI_FRESH_AIR = {
  code: 'smartmi-fresh-air',
  tools: [
    {
      name: 'smartmi_get_state',
      description:
        'Прочитать состояние Smartmi Fresh Air: CO2, PM2.5, влажность, температура, режим, экран, звук, блокировка, подогрев, обороты, фильтр и наработка. Не заменяет настройку.',
      schema: smartmiFreshAir.GET_STATE_SCHEMA,
      run: smartmiFreshAir.getState,
      describe: describeState,
    },
    {
      name: 'smartmi_set_power',
      description:
        'Включить или выключить Smartmi Fresh Air по явной просьбе. Не использовать для отрицаний, цитат или вопросов о возможности действия.',
      schema: smartmiFreshAir.SET_POWER_SCHEMA,
      run: smartmiFreshAir.setPower,
      describe: (state: smartmiFreshAir.SmartmiState) => (state.power ? 'включён.' : 'выключен.'),
    },
    {
      name: 'smartmi_set_mode',
      description:
        'Выбрать режим Smartmi Fresh Air: auto — автоматический, silent — ночной, interval — интервальный, low/middle/strong — ручная скорость 1/2/3. Не задаёт целевую температуру или CO2.',
      schema: smartmiFreshAir.SET_MODE_SCHEMA,
      run: smartmiFreshAir.setMode,
      describe: (
        _state: smartmiFreshAir.SmartmiState,
        args: z.infer<typeof smartmiFreshAir.SET_MODE_SCHEMA>,
      ) => `Режим: ${MODE_NAMES[args.mode]}.`,
    },
    {
      name: 'smartmi_set_speed',
      description:
        'Установить ручную скорость Smartmi Fresh Air: 1 — низкая, 2 — средняя, 3 — высокая. Выходит из автоматического, ночного или интервального режима. Не задаёт обороты в минуту.',
      schema: smartmiFreshAir.SET_SPEED_SCHEMA,
      run: smartmiFreshAir.setSpeed,
      describe: (state: smartmiFreshAir.SmartmiState) => `Скорость ${state.speed}.`,
    },
    {
      name: 'smartmi_set_brightness',
      description:
        'Яркость экрана Smartmi Fresh Air: bright — ярко, dim — тускло, off — выключить экран. Не выключает вентиляцию.',
      schema: smartmiFreshAir.SET_BRIGHTNESS_SCHEMA,
      run: smartmiFreshAir.setBrightness,
      describe: (
        _state: smartmiFreshAir.SmartmiState,
        args: z.infer<typeof smartmiFreshAir.SET_BRIGHTNESS_SCHEMA>,
      ) => `Экран: ${BRIGHTNESS_NAMES[args.brightness]}.`,
    },
    {
      name: 'smartmi_set_buzzer',
      description: 'Включить или выключить звуковые сигналы Smartmi Fresh Air.',
      schema: smartmiFreshAir.SET_BUZZER_SCHEMA,
      run: smartmiFreshAir.setBuzzer,
      describe: (state: smartmiFreshAir.SmartmiState) =>
        `Звуковые сигналы ${state.buzzer ? 'включены' : 'выключены'}.`,
    },
    {
      name: 'smartmi_set_child_lock',
      description: 'Включить или выключить блокировку кнопок Smartmi Fresh Air.',
      schema: smartmiFreshAir.SET_CHILD_LOCK_SCHEMA,
      run: smartmiFreshAir.setChildLock,
      describe: (state: smartmiFreshAir.SmartmiState) =>
        `Блокировка кнопок ${state.childLock ? 'включена' : 'выключена'}.`,
    },
    {
      name: 'smartmi_set_heater',
      description:
        'Включить или выключить PTC-подогрев Smartmi Fresh Air VA4. Не выключает вентиляцию и не задаёт целевую температуру. У VA2 эта функция недоступна.',
      schema: smartmiFreshAir.SET_HEATER_SCHEMA,
      run: smartmiFreshAir.setHeater,
      describe: (state: smartmiFreshAir.SmartmiState) =>
        `Подогрев ${state.heater ? 'включён' : 'выключен'}.`,
    },
    {
      name: 'smartmi_reset_filter',
      description:
        'Сбросить счётчик часов фильтра Smartmi Fresh Air только после его замены и по явной просьбе пользователя. Не очищает фильтр физически.',
      schema: smartmiFreshAir.RESET_FILTER_SCHEMA,
      run: smartmiFreshAir.resetFilter,
      describe: () => 'Счётчик фильтра сброшен.',
    },
  ],
} as const;

function describeState(state: smartmiFreshAir.SmartmiState) {
  const parts = [
    state.power ? 'включён.' : 'выключен.',
    state.humidity === undefined ? undefined : `Влажность ${state.humidity} процентов.`,
    state.temperature === undefined ? undefined : `Температура ${state.temperature} градусов.`,
    state.co2 === undefined ? undefined : `CO2 ${state.co2} ppm.`,
    state.pm25 === undefined ? undefined : `PM2.5 ${state.pm25} микрограммов на кубометр.`,
    state.mode === undefined ? undefined : `Режим: ${MODE_NAMES[state.mode]}.`,
    state.brightness === undefined ? undefined : `Экран: ${BRIGHTNESS_NAMES[state.brightness]}.`,
    state.buzzer === undefined
      ? undefined
      : `Звуковые сигналы ${state.buzzer ? 'включены' : 'выключены'}.`,
    state.childLock === undefined
      ? undefined
      : `Блокировка кнопок ${state.childLock ? 'включена' : 'выключена'}.`,
    state.heater === undefined ? undefined : `Подогрев ${state.heater ? 'включён' : 'выключен'}.`,
    state.filterHours === undefined ? undefined : `Фильтр отработал ${state.filterHours} часов.`,
    state.filterLife === undefined ? undefined : `Ресурс фильтра ${state.filterLife} процентов.`,
    state.motorRpm === undefined ? undefined : `Вентилятор: ${state.motorRpm} оборотов в минуту.`,
    state.heaterTemperature === undefined
      ? undefined
      : `Температура датчика нагревателя ${state.heaterTemperature} градусов.`,
    state.averagePm25 === undefined
      ? undefined
      : `Среднее PM2.5: ${state.averagePm25} микрограммов на кубометр.`,
    state.useSeconds === undefined
      ? undefined
      : `Общая наработка ${Math.round(state.useSeconds / 3600)} часов.`,
  ];
  return parts.filter((part) => part !== undefined).join(' ');
}
