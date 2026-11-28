import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { v7 } from 'uuid';
import { DeviceModelCode, runDeviceCommand } from '../src/lib/smart-home';
import { buildApp } from './application';
import { createTestDatabase } from './database';
import type { DeviceCommand } from './service-resources';

test('HTTP commands use the stored model, validate arguments and return confirmed state', async (t) => {
  const database = await createTestDatabase();
  t.after(database.close);
  const recordingsDir = await mkdtemp(join(tmpdir(), 'friday-command-api-'));
  t.after(() => rm(recordingsDir, { recursive: true, force: true }));
  const calls: DeviceCommand[] = [];
  let reported: unknown = { power: true, mode: 'manual', speed: 3 };
  const app = await buildApp({
    db: database.db,
    recordingsDir,
    driver: async (command) => {
      calls.push(command);
      return reported;
    },
  });
  t.after(() => app.close());
  const origin = await app.listen({ host: '127.0.0.1', port: 0 });
  const fetchHttp = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', (url: string, init: RequestInit) => {
    const target = new URL(url, origin);
    return fetchHttp(target, init);
  });
  const orm = database.db.orm.public;
  const home = await orm.Home.select('id').create({ displayName: 'Home' });
  const room = await orm.Room.select('id').create({ homeId: home.id, displayName: 'Room' });
  const credentials = { ip: '192.0.2.1', token: '0123456789abcdef0123456789abcdef' };
  const appliances = { displayName: 'Device', roomId: room.id, registrationData: credentials };
  const model = DeviceModelCode.BalluAsp100;
  const balluType = await orm.HomeDeviceType.select('id').firstOrThrow({ code: model });
  const ballu = await orm.HomeDevice.select('id').create({ ...appliances, typeId: balluType.id });
  const device = { id: ballu.id, model } as const;
  const state = await runDeviceCommand(device, 'setSpeed', { speed: 3 });
  assert.equal(state.speed, 3);
  assert.deepEqual(state, reported);
  assert.deepEqual(calls, [
    {
      model,
      transport: 'syncleo',
      operation: 'speed',
      parameters: { speed: 3 },
      registrationData: credentials,
    },
  ]);

  const monitorModel = DeviceModelCode.QingpingAirMonitorLite;
  const monitorType = await orm.HomeDeviceType.select('id').firstOrThrow({ code: monitorModel });
  const monitor = await orm.HomeDevice.select('id').create({
    ...appliances,
    typeId: monitorType.id,
  });
  const sensor = { id: monitor.id, model: monitorModel } as const;
  // @ts-expect-error Qingping has no setSpeed command.
  await assert.rejects(runDeviceCommand(sensor, 'setSpeed', { speed: 3 }), { code: 'unsupported' });
  // @ts-expect-error setSpeed requires a numeric speed.
  await assert.rejects(runDeviceCommand(device, 'setSpeed', { speed: '3' }), {
    code: 'invalid_device_command',
  });
  // @ts-expect-error getState accepts an empty object.
  await assert.rejects(runDeviceCommand(device, 'getState', { token: 'override' }), {
    code: 'invalid_device_command',
  });

  const url = `/api/smart-home/devices/${device.id}/commands`;
  for (const [path, body, status, code] of [
    [`${url}/setSpeed`, '{"speed":8}', 400, 'invalid_device_command'],
    [`${url}/getState`, '{', 400, 'invalid_device_command'],
    [`${url}/getState`, 'null', 400, 'invalid_device_command'],
    [`${url}/constructor`, '{}', 400, 'unsupported'],
    ['/api/smart-home/devices/invalid/commands/getState', '{}', 400, 'invalid_device_command'],
    [`/api/smart-home/devices/${v7()}/commands/getState`, '{}', 404, 'device_not_found'],
  ] as const) {
    const response = await fetch(path, { method: 'POST', body });
    assert.equal(response.status, status);
    const error = await response.json();
    assert.equal(error.code, code);
  }
  assert.equal(calls.length, 1);
  reported = { power: true, speed: 1, mode: 'manual' };
  await assert.rejects(runDeviceCommand(device, 'setSpeed', { speed: 3 }), {
    code: 'not_confirmed',
  });
  reported = { power: true, token: credentials.token };
  const invalid = await fetch(`${url}/getState`, { method: 'POST', body: '{}' });
  assert.equal(invalid.status, 502);
  const error = await invalid.json();
  assert.equal(error.code, 'invalid_device_state');
  assert.equal(JSON.stringify(error).includes(credentials.token), false);
  reported = { temperature: 21, humidity: 40, co2: 530, pm25: 3, pm10: 6 };
  const reading = await runDeviceCommand(sensor, 'getState', {});
  assert.equal(reading.temperature, 21);
  assert.equal(calls.at(-1)?.transport, 'miio');
});
