import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { deviceId, userId } from '../src/config/identity.js';
import { type DeviceCommand, DeviceCommandError } from '../src/services/smartHome/driver.js';
import type { BalluState } from '../src/services/smartHome/models/balluAsp100.js';
import { createHomeTools } from '../src/services/smartHome/tools.js';
import { createTestDatabase } from './database.js';

const secret = 'test-private-token';
test('Ballu settings validate model, ranges, confirmation and safe capability failures', async (t) => {
  const database = await createTestDatabase();
  t.after(() => database.close());
  const db = database.db;
  const home = await db.home.create({
    data: { displayName: 'Квартира', rooms: { create: { displayName: 'Спальня Артема' } } },
    include: { rooms: true },
  });
  const types = await db.homeDeviceType.findMany();
  for (const code of ['ballu-oneair-asp-100', 'smartmi-fresh-air']) {
    await db.homeDevice.create({
      data: {
        roomId: home.rooms[0].id,
        typeId: types.find((type) => type.code === code)!.id,
        displayName: code.startsWith('ballu') ? 'Ballu' : 'Xiaomi',
        registrationData: code.startsWith('ballu')
          ? { shareUrl: `rusklimat://device-share/rusclimate/69/aabbcc?token=${secret}` }
          : { ip: '192.168.1.2', token: 'a'.repeat(32) },
      },
    });
  }
  const interaction = await db.interaction.create({
    data: { userId, deviceId, status: 'processing', inputAudioKey: `${randomUUID()}.wav` },
  });
  const requests: DeviceCommand[] = [];
  let failure: Error | undefined;
  let state: BalluState = { power: true };
  const tools = createHomeTools(db, async (command) => {
    requests.push(command);
    if (failure) throw failure;
    return state;
  });
  let sequence = 1;
  const run = (name: string, parameters: Record<string, unknown>, device = 'Ballu') =>
    tools.execute(interaction.id, sequence++, {
      function: { name, arguments: { device, ...parameters } },
    });
  const cases: Array<[string, Record<string, unknown>, BalluState, RegExp]> = [
    ['set_ballu_mode', { mode: 'night' }, { power: true, mode: 'night' }, /режим ночной/],
    ['set_ballu_mode', { mode: 'eco' }, { power: true, mode: 'eco' }, /экопроветривание/],
    ['set_ballu_mode', { mode: 'turbo' }, { power: true, mode: 'turbo' }, /15 минут/],
    ['set_ballu_speed', { speed: 3 }, { power: true, mode: 'manual', speed: 3 }, /скорость 3/],
    [
      'set_ballu_temperature',
      { temperature: 22 },
      { power: false, heaterInstalled: true, targetTemperature: 22 },
      /приточного воздуха 22/,
    ],
    [
      'set_ballu_button_sound',
      { enabled: false },
      { power: true, buttonSound: false },
      /звуки кнопок выключены/,
    ],
    [
      'set_ballu_backlight_auto_off',
      { enabled: true },
      { power: true, backlightAutoOff: true },
      /автоматическое гашение подсветки включено/,
    ],
    ['set_ballu_sound', { sound: 'rain' }, { power: true, sound: 'rain' }, /дождь/],
    ['set_ballu_sound', { sound: 'off' }, { power: true, sound: 'off' }, /фоновый звук выключен/],
    [
      'reset_ballu_filter',
      {},
      { power: false, filterCounter: 0 },
      /счётчик основного фильтра сброшен/,
    ],
  ];
  for (const [name, args, confirmed, expected] of cases) {
    state = confirmed;
    assert.match(await run(name, args), expected);
    state = { power: true };
    assert.match(
      await run(name, args),
      /не подтвердил/,
      'Missing confirmation must never count as success',
    );
  }
  const before = requests.length;
  for (const [name, args] of [
    ['set_ballu_speed', { speed: 8 }],
    ['set_ballu_speed', { speed: 0 }],
    ['set_ballu_speed', { speed: 2.5 }],
    ['set_ballu_temperature', { temperature: 26 }],
    ['set_ballu_temperature', { temperature: 4 }],
    ['set_ballu_mode', { mode: 'auto' }],
    ['set_ballu_sound', { sound: 'random' }],
    ['set_ballu_button_sound', { enabled: 'false' }],
    ['reset_ballu_filter', { prefilter: true }],
    ['set_ballu_speed', { speed: 3, token: secret }],
  ] as Array<[string, Record<string, unknown>]>)
    assert.match(await run(name, args), /разобрать|целым числом/);
  assert.match(await run('set_ballu_speed', { speed: 3 }, 'Xiaomi'), /только для Ballu/);
  assert.equal(requests.length, before, 'Invalid or wrong-model commands must not touch hardware');
  failure = new DeviceCommandError('heater_missing');
  assert.match(
    await run('set_ballu_temperature', { temperature: 20 }),
    /не установлен нагреватель/,
  );
  failure = new Error(secret);
  const failed = await run('set_ballu_speed', { speed: 3 });
  assert.ok(!failed.includes(secret));
  assert.match(failed, /Не удалось/);
  failure = undefined;
  state = {
    power: true,
    mode: 'manual',
    speed: 1,
    temperature: 25,
    targetTemperature: 22,
    co2SensorInstalled: false,
    co2: 0,
    filterCounter: 17,
    errorCode: 0,
    sound: 'off',
    buttonSound: true,
    backlightAutoOff: false,
  };
  const summary = await run('get_device_state', {});
  assert.match(summary, /приточного воздуха 25/);
  assert.match(summary, /счётчика фильтра 17/);
  assert.match(summary, /Ошибок нет/);
  assert.ok(!summary.includes('CO2'));
  delete state.co2SensorInstalled;
  assert.ok(
    !(await run('get_device_state', {})).includes('CO2'),
    'Installed Ballu units have no CO2 sensor even if the capability packet is absent',
  );
  const catalogue = await tools.catalogue();
  assert.ok(catalogue.find((d) => d.device === 'Ballu')!.commands.includes('set_ballu_speed'));
  assert.ok(!catalogue.find((d) => d.device === 'Xiaomi')!.commands.includes('set_ballu_speed'));
  const actions = await db.interactionAction.findMany({ where: { interactionId: interaction.id } });
  assert.ok(!JSON.stringify(actions).includes(secret));
});
