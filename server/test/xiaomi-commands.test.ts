import assert from 'node:assert/strict';
import test from 'node:test';
import type { DeviceCommand } from '../src/services/smart-home/driver';
import { withServiceResources } from './service-resources';

const { DEVICE_TOOLS: TOOLS } = await import('./home-tools');

const DEVICE_ID = '019ace9d-0000-7000-8000-000000000001';
const QINGPING_STATE = { humidity: 40, temperature: 23.7, co2: 800, pm25: 5, pm10: 9 };
const CASES: [string, string, string, unknown][] = [
  ['smartmi_set_mode', 'mode', 'mode', 'silent'],
  ['smartmi_set_speed', 'speed', 'speed', 3],
  ['smartmi_set_brightness', 'brightness', 'brightness', 'off'],
  ['smartmi_set_buzzer', 'buzzer', 'buzzer', false],
  ['smartmi_set_child_lock', 'childLock', 'childLock', true],
  ['smartmi_set_heater', 'heater', 'heater', false],
  ['xiaomi_humidifier_set_level', 'level', 'level', 4],
  ['xiaomi_humidifier_set_mode', 'mode', 'mode', 'constantHumidity'],
  ['xiaomi_humidifier_set_target_humidity', 'targetHumidity', 'targetHumidity', 65],
  ['xiaomi_humidifier_set_buzzer', 'buzzer', 'buzzer', true],
  ['xiaomi_humidifier_set_indicator', 'indicator', 'indicator', false],
  ['xiaomi_humidifier_set_overwet_protection', 'overwetProtection', 'overwetProtection', true],
  ['xiaomi_humidifier_set_constant_protection', 'constantProtection', 'constantProtection', false],
  ['qingping_set_power_off_seconds', 'powerOffSeconds', 'powerOffSeconds', 120],
  ['qingping_set_pm25_standard', 'pm25Standard', 'pm25Standard', 'us'],
  ['qingping_set_monitoring_interval', 'monitoringInterval', 'monitoringInterval', 60],
  ['qingping_set_screen_off_delay', 'screenOffDelay', 'screenOffDelay', 0],
  ['qingping_set_power_off_delay', 'powerOffDelay', 'powerOffDelay', 0],
  ['qingping_set_temperature_unit', 'temperatureUnit', 'temperatureUnit', 'f'],
  ['qingping_set_screensaver_delay', 'screensaverDelay', 'screensaverDelay', 120],
  ['qingping_set_auto_slide_interval', 'autoSlideInterval', 'autoSlideInterval', 30],
  ['qingping_set_clock_format', 'twelveHourClock', 'twelveHourClock', true],
];

test(
  'all added settings send model-specific operations and require matching readback',
  checkSettings,
);
test('Xiaomi argument schemas reject unsupported values, coercion and extra keys', checkArguments);
test('Smartmi filter reset requires a reported zero counter', checkFilterReset);
test(
  'monitor and humidifier describe diagnostics without inventing power or measurements',
  checkDescriptions,
);

async function checkSettings() {
  for (const [name, operation, field, value] of CASES) {
    const entry = TOOLS.get(name)!;
    assert.ok(entry, name);
    const input = { deviceId: DEVICE_ID, [field]: value };
    const args = entry.tool.schema.parse(input);
    const connection = {
      model: entry.model.code,
      transport: entry.model.transport,
      registrationData: {},
    };
    const base = name.startsWith('qingping') ? QINGPING_STATE : { power: false };
    const state = { ...base, [field]: value };
    const calls: DeviceCommand[] = [];
    const driver = capture.bind(null, calls, state);
    const result = await withServiceResources({ driver }, () =>
      entry.tool.execute(args, connection),
    );
    assert.equal(calls.length, 1, name);
    assert.equal(calls[0].model, entry.model.code);
    assert.equal(calls[0].operation, operation);
    assert.deepEqual(calls[0].parameters, { [field]: value });
    assert.equal(result.state[field], value);
    assert.match(result.description, /[А-Яа-яЁё]/);
    const missing = capture.bind(null, calls, base);
    const pending = withServiceResources({ driver: missing }, () =>
      entry.tool.execute(args, connection),
    );
    await assert.rejects(pending, { code: 'not_confirmed' }, name);
  }
}

async function capture(calls: DeviceCommand[], state: unknown, command: DeviceCommand) {
  calls.push(command);
  return state;
}

function checkArguments() {
  const invalid: [string, string, unknown[]][] = [
    ['smartmi_set_mode', 'mode', ['turbo', 'manual']],
    ['smartmi_set_speed', 'speed', [0, 4, 1.5, '2']],
    ['smartmi_set_brightness', 'brightness', [100, 'auto']],
    ['smartmi_set_heater', 'heater', ['false', 1]],
    ['xiaomi_humidifier_set_level', 'level', [0, 5, 2.5]],
    ['xiaomi_humidifier_set_mode', 'mode', ['auto', 1]],
    ['xiaomi_humidifier_set_target_humidity', 'targetHumidity', [39, 71, 55.5, '50']],
    ['qingping_set_monitoring_interval', 'monitoringInterval', [-1, 30, 601]],
    ['qingping_set_screen_off_delay', 'screenOffDelay', [-1, 10, 301]],
    ['qingping_set_power_off_delay', 'powerOffDelay', [-1, 5, 61]],
    ['qingping_set_temperature_unit', 'temperatureUnit', ['kelvin', 0]],
    ['qingping_set_screensaver_delay', 'screensaverDelay', [-1, 1801]],
    ['qingping_set_auto_slide_interval', 'autoSlideInterval', [-1, 3601]],
    ['qingping_set_clock_format', 'twelveHourClock', [12, 'true']],
    ['qingping_set_power_off_seconds', 'powerOffSeconds', [-1, 65536, 2.5]],
    ['qingping_set_pm25_standard', 'pm25Standard', ['reserved', 2]],
  ];
  for (const [name, field, values] of invalid) {
    const { tool } = TOOLS.get(name)!;
    for (const value of values) {
      const input = { deviceId: DEVICE_ID, [field]: value };
      const result = tool.schema.safeParse(input);
      assert.equal(result.success, false, name);
    }
  }
  for (const [name, , field, value] of CASES) {
    const { tool } = TOOLS.get(name)!;
    const input = { deviceId: DEVICE_ID, [field]: value, token: 'untrusted' };
    const extra = tool.schema.safeParse(input);
    assert.equal(extra.success, false);
    const missing = tool.schema.safeParse({ deviceId: DEVICE_ID });
    assert.equal(missing.success, false);
  }
  const hasPowerTool = TOOLS.has('qingping_set_power');
  assert.equal(hasPowerTool, false);
}

async function checkFilterReset() {
  const { model, tool } = TOOLS.get('smartmi_reset_filter')!;
  const args = tool.schema.parse({ deviceId: DEVICE_ID });
  const connection = { model: model.code, transport: model.transport, registrationData: {} };
  for (const counter of [undefined, 10]) {
    const state = { power: true, filterHours: counter };
    const driver = capture.bind(null, [], state);
    const pending = withServiceResources({ driver }, () => tool.execute(args, connection));
    await assert.rejects(pending, { code: 'not_confirmed' });
  }
  const calls: DeviceCommand[] = [];
  const driver = capture.bind(null, calls, { power: true, filterHours: 0 });
  const result = await withServiceResources({ driver }, () => tool.execute(args, connection));
  assert.equal(calls[0].operation, 'resetFilter');
  assert.equal(result.description, 'Счётчик фильтра сброшен.');
}

async function checkDescriptions() {
  for (const [name, state, expected] of [
    [
      'qingping_get_state',
      { ...QINGPING_STATE, battery: 0, chargingState: 0 },
      /CO2 800 ppm.*PM2.5 5, PM10 9.*Заряд 0 процентов/,
    ],
    [
      'xiaomi_humidifier_get_state',
      {
        power: true,
        waterShortage: true,
        tankLifted: true,
        humiditySensorFault: true,
        constantProtectionActive: true,
      },
      /Бак снят.*Недостаточно воды.*Ошибка датчика влажности.*Сработала защита/,
    ],
  ] as const) {
    const { model, tool } = TOOLS.get(name)!;
    const args = tool.schema.parse({ deviceId: DEVICE_ID });
    const connection = { model: model.code, transport: model.transport, registrationData: {} };
    const driver = capture.bind(null, [], state);
    const result = await withServiceResources({ driver }, () => tool.execute(args, connection));
    assert.match(result.description, expected);
  }
  const { model, tool } = TOOLS.get('qingping_get_state')!;
  const args = tool.schema.parse({ deviceId: DEVICE_ID });
  const connection = { model: model.code, transport: model.transport, registrationData: {} };
  const driver = capture.bind(null, [], { humidity: 40 });
  const pending = withServiceResources({ driver }, () => tool.execute(args, connection));
  await assert.rejects(pending, { code: 'invalid_device_state' });
}
