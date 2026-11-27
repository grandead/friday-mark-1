export const QINGPING_AIR_MONITOR_LITE = {
  code: 'qingping-air-monitor-lite',
  tools: [
    {
      name: 'qingping_get_state',
      description:
        'Прочитать Qingping Air Monitor Lite: CO2, PM2.5, PM10, температуру, влажность, батарею и настройки экрана. Это монитор, он не проветривает и не увлажняет. Отдельной команды включения питания нет.',
      operation: 'state',
    },
    {
      name: 'qingping_set_power_off_seconds',
      description:
        'Задать время автоматического выключения Qingping CGD1ST в секундах, от 0 до 65535. Ноль отключает таймер. Это более точная версия настройки в минутах; не вызывай обе для одной настройки. У CGDN1 эта команда недоступна.',
      operation: 'powerOffSeconds',
    },
    {
      name: 'qingping_set_pm25_standard',
      description:
        'Стандарт цветовой оценки PM2.5 на Qingping CGD1ST: cn — китайский, us — американский. Не меняет измеренную концентрацию и не калибрует датчик. У CGDN1 эта команда недоступна.',
      operation: 'pm25Standard',
    },
    {
      name: 'qingping_set_monitoring_interval',
      description:
        'Интервал измерений Qingping Air Monitor Lite в секундах: 1, 60, 300 или 600; 0 — параметр не задан. Не является интервалом обновления журнала.',
      operation: 'monitoringInterval',
    },
    {
      name: 'qingping_set_screen_off_delay',
      description:
        'Автоматическое выключение экрана Qingping Air Monitor Lite через 15, 30, 60, 300 секунд, а для ревизии CGD1ST также 600 секунд; 0 — не выключать. Не выключает сам прибор.',
      operation: 'screenOffDelay',
    },
    {
      name: 'qingping_set_power_off_delay',
      description:
        'Автоматическое выключение Qingping Air Monitor Lite через 15, 30, 60 минут, а для ревизии CGD1ST также 10 минут; 0 — не выключать. После выключения прибор нельзя включить этим локальным API.',
      operation: 'powerOffDelay',
    },
    {
      name: 'qingping_set_temperature_unit',
      description:
        'Единицы температуры на экране Qingping Air Monitor Lite: c — Цельсий, f — Фаренгейт. Измерения API остаются в Цельсиях.',
      operation: 'temperatureUnit',
    },
    {
      name: 'qingping_set_screensaver_delay',
      description:
        'Задержка экранной заставки Qingping Air Monitor Lite от 0 до 1800 секунд. Не меняет тип заставки.',
      operation: 'screensaverDelay',
    },
    {
      name: 'qingping_set_auto_slide_interval',
      description:
        'Интервал автоматического перелистывания показаний Qingping Air Monitor Lite от 0 до 3600 секунд; 0 — без автоперелистывания.',
      operation: 'autoSlideInterval',
    },
    {
      name: 'qingping_set_clock_format',
      description:
        'Формат часов Qingping Air Monitor Lite: true — 12 часов, false — 24 часа. Не меняет часовой пояс.',
      operation: 'twelveHourClock',
    },
  ],
} as const;
