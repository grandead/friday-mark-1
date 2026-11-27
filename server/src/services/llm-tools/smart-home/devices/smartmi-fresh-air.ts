export const SMARTMI_FRESH_AIR = {
  code: 'smartmi-fresh-air',
  tools: [
    {
      name: 'smartmi_get_state',
      description:
        'Прочитать состояние Smartmi Fresh Air: CO2, PM2.5, влажность, температура, режим, экран, звук, блокировка, подогрев, обороты, фильтр и наработка. Не заменяет настройку.',
      operation: 'state',
    },
    {
      name: 'smartmi_set_power',
      description:
        'Включить или выключить Smartmi Fresh Air по явной просьбе. Не использовать для отрицаний, цитат или вопросов о возможности действия.',
      operation: 'power',
    },
    {
      name: 'smartmi_set_mode',
      description:
        'Выбрать режим Smartmi Fresh Air: auto — автоматический, silent — ночной, interval — интервальный, low/middle/strong — ручная скорость 1/2/3. Не задаёт целевую температуру или CO2.',
      operation: 'mode',
    },
    {
      name: 'smartmi_set_speed',
      description:
        'Установить ручную скорость Smartmi Fresh Air: 1 — низкая, 2 — средняя, 3 — высокая. Выходит из автоматического, ночного или интервального режима. Не задаёт обороты в минуту.',
      operation: 'speed',
    },
    {
      name: 'smartmi_set_brightness',
      description:
        'Яркость экрана Smartmi Fresh Air: bright — ярко, dim — тускло, off — выключить экран. Не выключает вентиляцию.',
      operation: 'brightness',
    },
    {
      name: 'smartmi_set_buzzer',
      description: 'Включить или выключить звуковые сигналы Smartmi Fresh Air.',
      operation: 'buzzer',
    },
    {
      name: 'smartmi_set_child_lock',
      description: 'Включить или выключить блокировку кнопок Smartmi Fresh Air.',
      operation: 'childLock',
    },
    {
      name: 'smartmi_set_heater',
      description:
        'Включить или выключить PTC-подогрев Smartmi Fresh Air VA4. Не выключает вентиляцию и не задаёт целевую температуру. У VA2 эта функция недоступна.',
      operation: 'heater',
    },
    {
      name: 'smartmi_reset_filter',
      description:
        'Сбросить счётчик часов фильтра Smartmi Fresh Air только после его замены и по явной просьбе пользователя. Не очищает фильтр физически.',
      operation: 'resetFilter',
    },
  ],
} as const;
