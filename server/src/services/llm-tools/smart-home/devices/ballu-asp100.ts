export const BALLU_ASP100 = {
  code: 'ballu-oneair-asp-100',
  tools: [
    {
      name: 'ballu_get_state',
      description:
        'Прочитать состояние Ballu ASP-100. В этих приборах нет датчиков CO2. Только для вопросов о состоянии, не вместо настройки.',
      operation: 'state',
    },
    {
      name: 'ballu_set_power',
      description:
        'Включить или выключить Ballu ASP-100 по явной просьбе. Не использовать для отдельного управления нагревателем.',
      operation: 'power',
    },
    {
      name: 'ballu_set_mode',
      description:
        'Выбрать режим Ballu ASP-100: manual — ручной, night — ночной, turbo — 15 минут, затем прежний режим, eco — пассивное проветривание без вентилятора и нагрева. Включает прибор. Датчиков CO2 нет, авторежим недоступен. Eco не заменяет отключение только подогрева.',
      operation: 'mode',
    },
    {
      name: 'ballu_set_speed',
      description:
        'Установить скорость Ballu ASP-100 от 1 до 7. Включает ручной режим и выходит из ночного/турбо. Не управляет отдельной скоростью ночного режима. При недопустимом числе уточни значение, не округляй и не ограничивай его.',
      operation: 'speed',
      invalidReply: 'Скорость должна быть целым числом от 1 до 7. Какую скорость установить?',
    },
    {
      name: 'ballu_set_temperature',
      description:
        'Задать температуру подогрева ПРИТОЧНОГО воздуха Ballu ASP-100, целое число 5–25. Требуется нагреватель. Это не температура комнаты и не включение/выключение нагрева. При недопустимом числе уточни значение, не подменяй его допустимым.',
      operation: 'targetTemperature',
      invalidReply:
        'Температура приточного воздуха должна быть целым числом от 5 до 25 градусов. Какую температуру задать?',
    },
    {
      name: 'ballu_set_button_sound',
      description:
        'Включить или выключить звуки кнопок Ballu ASP-100. Не относится к фоновым мелодиям.',
      operation: 'buttonSound',
    },
    {
      name: 'ballu_set_backlight_auto_off',
      description:
        'Включить или выключить АВТОМАТИЧЕСКОЕ гашение подсветки Ballu ASP-100. Это не мгновенное включение/выключение света; при таком запросе уточни, подходит ли автогашение.',
      operation: 'backlightAutoOff',
    },
    {
      name: 'ballu_set_sound',
      description:
        'Фоновый звук Ballu ASP-100: off — выключить, rain — дождь, sea — море, forest — лес, birds — птицы, fireplace — камин.',
      operation: 'sound',
    },
    {
      name: 'ballu_reset_filter',
      description:
        'Сбросить счётчик ОСНОВНОГО фильтра Ballu ASP-100 только по явной просьбе после обслуживания. Вопрос о ресурсе фильтра требует чтения состояния. Не сбрасывает префильтр.',
      operation: 'resetFilter',
    },
  ],
} as const;
