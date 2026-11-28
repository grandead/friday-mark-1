import { DeviceModelCode, qingpingAirMonitorLite } from '../../../smart-home';

const CHARGING_NAMES: Record<number, string> = {
  0: 'без внешнего питания',
  1: 'заряжается',
  2: 'не заряжается',
  3: 'зарядка недоступна',
};

export const QINGPING_AIR_MONITOR_LITE = {
  code: DeviceModelCode.QingpingAirMonitorLite,
  tools: [
    {
      name: 'qingping_get_state',
      description:
        'Прочитать Qingping Air Monitor Lite: CO2, PM2.5, PM10, температуру, влажность, батарею и настройки экрана. Это монитор, он не проветривает и не увлажняет. Отдельной команды включения питания нет.',
      schema: qingpingAirMonitorLite.GET_STATE_SCHEMA,
      run: qingpingAirMonitorLite.getState,
      describe: describeState,
    },
    {
      name: 'qingping_set_power_off_seconds',
      description:
        'Задать время автоматического выключения Qingping CGD1ST в секундах, от 0 до 65535. Ноль отключает таймер. Это более точная версия настройки в минутах; не вызывай обе для одной настройки. У CGDN1 эта команда недоступна.',
      schema: qingpingAirMonitorLite.SET_POWER_OFF_SECONDS_SCHEMA,
      run: qingpingAirMonitorLite.setPowerOffSeconds,
      describe: (state: qingpingAirMonitorLite.QingpingState) =>
        state.powerOffSeconds === 0
          ? 'Автовыключение прибора отключено.'
          : `Прибор будет выключаться через ${state.powerOffSeconds} секунд.`,
    },
    {
      name: 'qingping_set_pm25_standard',
      description:
        'Стандарт цветовой оценки PM2.5 на Qingping CGD1ST: cn — китайский, us — американский. Не меняет измеренную концентрацию и не калибрует датчик. У CGDN1 эта команда недоступна.',
      schema: qingpingAirMonitorLite.SET_PM25_STANDARD_SCHEMA,
      run: qingpingAirMonitorLite.setPm25Standard,
      describe: (state: qingpingAirMonitorLite.QingpingState) =>
        `Стандарт оценки PM2.5: ${state.pm25Standard === 'cn' ? 'китайский' : 'американский'}.`,
    },
    {
      name: 'qingping_set_monitoring_interval',
      description:
        'Интервал измерений Qingping Air Monitor Lite в секундах: 1, 60, 300 или 600; 0 — параметр не задан. Не является интервалом обновления журнала.',
      schema: qingpingAirMonitorLite.SET_MONITORING_INTERVAL_SCHEMA,
      run: qingpingAirMonitorLite.setMonitoringInterval,
      describe: (state: qingpingAirMonitorLite.QingpingState) =>
        `Интервал измерений: ${state.monitoringInterval} секунд.`,
    },
    {
      name: 'qingping_set_screen_off_delay',
      description:
        'Автоматическое выключение экрана Qingping Air Monitor Lite через 15, 30, 60, 300 секунд, а для ревизии CGD1ST также 600 секунд; 0 — не выключать. Не выключает сам прибор.',
      schema: qingpingAirMonitorLite.SET_SCREEN_OFF_DELAY_SCHEMA,
      run: qingpingAirMonitorLite.setScreenOffDelay,
      describe: (state: qingpingAirMonitorLite.QingpingState) =>
        state.screenOffDelay === 0
          ? 'Автовыключение экрана отключено.'
          : `Экран будет выключаться через ${state.screenOffDelay} секунд.`,
    },
    {
      name: 'qingping_set_power_off_delay',
      description:
        'Автоматическое выключение Qingping Air Monitor Lite через 15, 30, 60 минут, а для ревизии CGD1ST также 10 минут; 0 — не выключать. После выключения прибор нельзя включить этим локальным API.',
      schema: qingpingAirMonitorLite.SET_POWER_OFF_DELAY_SCHEMA,
      run: qingpingAirMonitorLite.setPowerOffDelay,
      describe: (state: qingpingAirMonitorLite.QingpingState) =>
        state.powerOffDelay === 0
          ? 'Автовыключение прибора отключено.'
          : `Прибор будет выключаться через ${state.powerOffDelay} минут.`,
    },
    {
      name: 'qingping_set_temperature_unit',
      description:
        'Единицы температуры на экране Qingping Air Monitor Lite: c — Цельсий, f — Фаренгейт. Измерения API остаются в Цельсиях.',
      schema: qingpingAirMonitorLite.SET_TEMPERATURE_UNIT_SCHEMA,
      run: qingpingAirMonitorLite.setTemperatureUnit,
      describe: (state: qingpingAirMonitorLite.QingpingState) =>
        `На экране: градусы ${state.temperatureUnit === 'c' ? 'Цельсия' : 'Фаренгейта'}.`,
    },
    {
      name: 'qingping_set_screensaver_delay',
      description:
        'Задержка экранной заставки Qingping Air Monitor Lite от 0 до 1800 секунд. Не меняет тип заставки.',
      schema: qingpingAirMonitorLite.SET_SCREENSAVER_DELAY_SCHEMA,
      run: qingpingAirMonitorLite.setScreensaverDelay,
      describe: (state: qingpingAirMonitorLite.QingpingState) =>
        `Задержка заставки ${state.screensaverDelay} секунд.`,
    },
    {
      name: 'qingping_set_auto_slide_interval',
      description:
        'Интервал автоматического перелистывания показаний Qingping Air Monitor Lite от 0 до 3600 секунд; 0 — без автоперелистывания.',
      schema: qingpingAirMonitorLite.SET_AUTO_SLIDE_INTERVAL_SCHEMA,
      run: qingpingAirMonitorLite.setAutoSlideInterval,
      describe: (state: qingpingAirMonitorLite.QingpingState) =>
        state.autoSlideInterval === 0
          ? 'Автоперелистывание отключено.'
          : `Автоперелистывание каждые ${state.autoSlideInterval} секунд.`,
    },
    {
      name: 'qingping_set_clock_format',
      description:
        'Формат часов Qingping Air Monitor Lite: true — 12 часов, false — 24 часа. Не меняет часовой пояс.',
      schema: qingpingAirMonitorLite.SET_TWELVE_HOUR_CLOCK_SCHEMA,
      run: qingpingAirMonitorLite.setTwelveHourClock,
      describe: (state: qingpingAirMonitorLite.QingpingState) =>
        `Формат часов: ${state.twelveHourClock ? 12 : 24} часа.`,
    },
  ],
} as const;

function describeState(state: qingpingAirMonitorLite.QingpingState) {
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
  return parts.filter((part) => part !== undefined).join(' ');
}
