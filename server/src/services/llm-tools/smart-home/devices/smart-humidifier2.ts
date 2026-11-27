export const SMART_HUMIDIFIER_2 = {
  code: 'xiaomi-smart-humidifier-2',
  tools: [
    {
      name: 'xiaomi_humidifier_get_state',
      description:
        'Прочитать состояние Xiaomi Smart Humidifier 2: влажность, температура, режим, уровень, цель, работа, ошибки, вода, бак, звук, индикаторы и защиты. Не заменяет настройку.',
      operation: 'state',
    },
    {
      name: 'xiaomi_humidifier_set_power',
      description:
        'Включить или выключить Xiaomi Smart Humidifier 2 по явной просьбе. Не использовать для отрицаний, цитат или вопросов о возможности действия.',
      operation: 'power',
    },
    {
      name: 'xiaomi_humidifier_set_level',
      description:
        'Установить интенсивность Xiaomi Smart Humidifier 2: 1/2/3 — ручные уровни, 4 — поддержание влажности. Четвёртый уровень не является максимальной мощностью.',
      operation: 'level',
    },
    {
      name: 'xiaomi_humidifier_set_mode',
      description:
        'Режим Xiaomi Smart Humidifier 2: manual — ручной уровень, constantHumidity — поддержание целевой влажности. Цель задаётся отдельной командой.',
      operation: 'mode',
    },
    {
      name: 'xiaomi_humidifier_set_target_humidity',
      description:
        'Задать целевую влажность Xiaomi Smart Humidifier 2 от 40 до 70 процентов, шаг 1. Для поддержания цели нужен режим constantHumidity. Не включает прибор и не заменяет отдельный выбор режима.',
      operation: 'targetHumidity',
    },
    {
      name: 'xiaomi_humidifier_set_buzzer',
      description: 'Включить или выключить звуковые сигналы Xiaomi Smart Humidifier 2.',
      operation: 'buzzer',
    },
    {
      name: 'xiaomi_humidifier_set_indicator',
      description: 'Включить или выключить индикаторы Xiaomi Smart Humidifier 2.',
      operation: 'indicator',
    },
    {
      name: 'xiaomi_humidifier_set_overwet_protection',
      description:
        'Включить или выключить защиту от избыточной влажности Xiaomi Smart Humidifier 2 по явной просьбе. Не отключает защиту от отсутствия воды.',
      operation: 'overwetProtection',
    },
    {
      name: 'xiaomi_humidifier_set_constant_protection',
      description:
        'Включить или выключить защитное отключение в режиме постоянной влажности Xiaomi Smart Humidifier 2 по явной просьбе. Это отдельный параметр защиты, а не переключение режима.',
      operation: 'constantProtection',
    },
  ],
} as const;
