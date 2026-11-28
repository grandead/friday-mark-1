import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { DeviceModelCode } from '../shared/device-model-code';
import { DEVICE_ID as deviceId, USER_ID as userId } from '../src/config/identity';
import type { BalluState } from '../src/services/smart-home/devices/ballu-asp100';
import { DeviceCommandError } from '../src/services/smart-home/utils';
import { createTestDatabase } from './database';
import { createHomeTools } from './home-tools';
import type { DeviceCommand } from './service-resources';

const secret = 'test-private-token';
test('Ballu settings validate model, ranges, confirmation and safe capability failures', async (t) => {
  const database = await createTestDatabase();
  t.after(() => database.close());
  const db = database.db;
  const home = await db.orm.public.Home.include('rooms').create({
    displayName: 'Квартира',
    rooms: (r) => r.create({ displayName: 'Спальня Артема' }),
  });
  const types = await db.orm.public.HomeDeviceType.all();
  for (const code of [DeviceModelCode.BalluAsp100, DeviceModelCode.SmartmiFreshAir]) {
    await db.orm.public.HomeDevice.create({
      roomId: home.rooms[0].id,
      typeId: types.find((type) => type.code === code)!.id,
      displayName: code.startsWith('ballu') ? 'Ballu' : 'Xiaomi',
      registrationData: code.startsWith('ballu')
        ? { ip: '192.0.2.1', token: secret }
        : { ip: '192.168.1.2', token: 'a'.repeat(32) },
    });
  }
  const interaction = await db.orm.public.Interaction.create({
    userId,
    deviceId,
    status: 'processing',
    inputAudioKey: `${randomUUID()}.wav`,
  });
  const requests: DeviceCommand[] = [];
  let failure: Error | undefined;
  let state: BalluState = { power: true };
  const tools = createHomeTools(db, async (command) => {
    requests.push(command);
    if (failure) throw failure;
    return state;
  });
  const catalogue = await tools.catalogue();
  const balluId = catalogue.find((d) => d.name === 'Ballu')!.id;
  const xiaomiId = catalogue.find((d) => d.name === 'Xiaomi')!.id;
  let sequence = 1;
  const run = (name: string, parameters: Record<string, unknown>, deviceId = balluId) =>
    tools.execute(interaction.id, sequence++, {
      function: { name, arguments: { deviceId, ...parameters } },
    });
  const cases: Array<[string, Record<string, unknown>, BalluState, RegExp]> = [
    ['ballu_set_mode', { mode: 'night' }, { power: true, mode: 'night' }, /режим ночной/],
    ['ballu_set_mode', { mode: 'eco' }, { power: true, mode: 'eco' }, /экопроветривание/],
    ['ballu_set_mode', { mode: 'turbo' }, { power: true, mode: 'turbo' }, /15 минут/],
    ['ballu_set_speed', { speed: 3 }, { power: true, mode: 'manual', speed: 3 }, /скорость 3/],
    [
      'ballu_set_temperature',
      { temperature: 22 },
      { power: false, heaterInstalled: true, targetTemperature: 22 },
      /приточного воздуха 22/,
    ],
    [
      'ballu_set_button_sound',
      { enabled: false },
      { power: true, buttonSound: false },
      /звуки кнопок выключены/,
    ],
    [
      'ballu_set_backlight_auto_off',
      { enabled: true },
      { power: true, backlightAutoOff: true },
      /автоматическое гашение подсветки включено/,
    ],
    ['ballu_set_sound', { sound: 'rain' }, { power: true, sound: 'rain' }, /дождь/],
    ['ballu_set_sound', { sound: 'off' }, { power: true, sound: 'off' }, /фоновый звук выключен/],
    [
      'ballu_reset_filter',
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
    ['ballu_set_speed', { speed: 8 }],
    ['ballu_set_speed', { speed: 0 }],
    ['ballu_set_speed', { speed: 2.5 }],
    ['ballu_set_temperature', { temperature: 26 }],
    ['ballu_set_temperature', { temperature: 4 }],
    ['ballu_set_mode', { mode: 'auto' }],
    ['ballu_set_sound', { sound: 'random' }],
    ['ballu_set_button_sound', { enabled: 'false' }],
    ['ballu_reset_filter', { prefilter: true }],
    ['ballu_set_speed', { speed: 3, token: secret }],
  ] as Array<[string, Record<string, unknown>]>)
    assert.match(await run(name, args), /разобрать|целым числом/);
  assert.match(
    await run('ballu_set_speed', { speed: 3 }, xiaomiId),
    /недоступна для выбранной модели/,
  );
  assert.equal(requests.length, before, 'Invalid or wrong-model commands must not touch hardware');
  failure = new DeviceCommandError('heater_missing');
  assert.match(
    await run('ballu_set_temperature', { temperature: 20 }),
    /не установлен нагреватель/,
  );
  failure = new Error(secret);
  const failed = await run('ballu_set_speed', { speed: 3 });
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
  const summary = await run('ballu_get_state', {});
  assert.match(summary, /приточного воздуха 25/);
  assert.match(summary, /счётчика фильтра 17/);
  assert.match(summary, /Ошибок нет/);
  assert.ok(!summary.includes('CO2'));
  delete state.co2SensorInstalled;
  assert.ok(
    !(await run('ballu_get_state', {})).includes('CO2'),
    'Installed Ballu units have no CO2 sensor even if the capability packet is absent',
  );
  assert.ok(catalogue.find((d) => d.name === 'Ballu')!.commands.includes('ballu_set_speed'));
  assert.ok(!catalogue.find((d) => d.name === 'Xiaomi')!.commands.includes('ballu_set_speed'));
  const actions = await db.orm.public.InteractionAction.where({
    interactionId: interaction.id,
  }).all();
  assert.ok(!JSON.stringify(actions).includes(secret));
});
