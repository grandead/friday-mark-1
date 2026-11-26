import assert from 'node:assert/strict';
import test from 'node:test';
import { v7, version } from 'uuid';
import type { createDevice } from '../src/app/api/smart-home/devices/_data/create-device';
import { parseDeviceRegistration } from '../src/app/api/smart-home/devices/_lib/device-registration';
import type { Database } from '../src/services/database';
import { createTestDatabase } from './database';
import { routes, withRouteResources } from './routes';

const miio = { ip: '192.168.1.12', token: 'abcdef0123456789abcdef0123456789' };
const hommyn = {
  shareUrl:
    'rusklimat://device-share/rusclimate/69/aabbccddeeff?token=0123456789abcdef0123456789abcdef&name=Ballu',
};

async function createHomeDevice(db: Database, input: unknown) {
  const response = await withRouteResources({ db, recordingsDir: '' }, () =>
    routes.createDevice(
      new Request('http://localhost/api/smart-home/devices', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    ),
  );
  const body = await response.json();
  if (!response.ok) throw new Error(body.message);
  return body as Awaited<ReturnType<typeof createDevice>>;
}

test('smart home migration seeds the model catalogue and keeps homes isolated', async (t) => {
  const database = await createTestDatabase();
  t.after(() => database.close());
  const db = database.db;
  const types = await db.orm.public.HomeDeviceType.orderBy((r) => r.code.asc()).all();
  assert.deepEqual(
    types.map((type) => [type.code, type.kind, type.registrationType]),
    [
      ['ballu-oneair-asp-100', 'breezer', 'hommynShareUrl'],
      ['qingping-air-monitor-lite', 'airMonitor', 'miioToken'],
      ['smartmi-fresh-air', 'breezer', 'miioToken'],
      ['xiaomi-smart-humidifier-2', 'humidifier', 'miioToken'],
    ],
  );
  assert.ok(types.every((type) => version(type.id) === 7));
  assert.equal(
    await db.orm.public.Home.aggregate((a) => ({ count: a.count() })).then((r) => r.count),
    0,
  );
  assert.equal(
    await db.orm.public.HomeDevice.aggregate((a) => ({ count: a.count() })).then((r) => r.count),
    0,
  );
  // Existing voice terminals still live in their original table.
  assert.equal(
    await db.orm.public.Device.aggregate((a) => ({ count: a.count() })).then((r) => r.count),
    1,
  );
  const first = await db.orm.public.Home.create({ displayName: 'Квартира' });
  const second = await db.orm.public.Home.create({ displayName: 'Дача' });
  const rooms = await Promise.all(
    [first, second].map((home) =>
      db.orm.public.Room.create({ homeId: home.id, displayName: 'Спальня' }),
    ),
  );
  const humidifierType = types.find((type) => type.kind === 'humidifier')!;
  const balluType = types.find((type) => type.vendor === 'Ballu')!;
  const humidifier = await createHomeDevice(db, {
    roomId: rooms[0].id,
    typeId: humidifierType.id,
    displayName: ' Увлажнитель ',
    registrationData: miio,
  });
  const ballu = await createHomeDevice(db, {
    roomId: rooms[1].id,
    typeId: balluType.id,
    displayName: 'Бризер',
    registrationData: hommyn,
  });
  assert.equal(humidifier.displayName, 'Увлажнитель');
  assert.equal('registrationData' in humidifier, false);
  assert.equal(version(humidifier.id), 7);
  const tree = await db.orm.public.Home.where({ id: first.id })
    .include('rooms', (r) => r.include('devices'))
    .firstOrThrow();
  assert.deepEqual(
    tree.rooms[0].devices.map((device) => device.id),
    [humidifier.id],
  );
  assert.deepEqual(tree.rooms[0].devices[0].registrationData, miio);
  assert.deepEqual(
    (await db.orm.public.HomeDevice.firstOrThrow({ id: ballu.id })).registrationData,
    hommyn,
  );

  await assert.rejects(
    createHomeDevice(db, {
      roomId: rooms[0].id,
      typeId: balluType.id,
      displayName: 'Wrong format',
      registrationData: miio,
    }),
    /Expected a/,
  );
  await assert.rejects(
    createHomeDevice(db, {
      roomId: rooms[0].id,
      typeId: humidifierType.id,
      displayName: 'Wrong format',
      registrationData: hommyn,
    }),
    /Expected a/,
  );
  await assert.rejects(
    createHomeDevice(db, {
      roomId: rooms[0].id,
      typeId: v7(),
      displayName: 'Unknown type',
      registrationData: miio,
    }),
  );
  await assert.rejects(
    createHomeDevice(db, {
      roomId: v7(),
      typeId: humidifierType.id,
      displayName: 'Unknown room',
      registrationData: miio,
    }),
  );
  await assert.rejects(
    db.orm.public.HomeDevice.create({
      roomId: rooms[0].id,
      typeId: humidifierType.id,
      displayName: 'Array instead of object',
      registrationData: [],
    }),
  );
  await assert.rejects(db.orm.public.Home.create({ displayName: '   ' }));
  await assert.rejects(db.orm.public.Home.where({ id: first.id }).delete());
  await assert.rejects(db.orm.public.Room.where({ id: rooms[0].id }).delete());
  await assert.rejects(db.orm.public.HomeDeviceType.where({ id: humidifierType.id }).delete());
  assert.equal(
    await db.orm.public.HomeDevice.aggregate((a) => ({ count: a.count() })).then((r) => r.count),
    2,
  );
});

test('registration schemas reject malformed credentials, extra fields and unrelated URLs', () => {
  assert.deepEqual(
    parseDeviceRegistration('miioToken', { ...miio, token: miio.token.toUpperCase() }),
    miio,
  );
  assert.deepEqual(parseDeviceRegistration('hommynShareUrl', hommyn), hommyn);
  for (const value of [
    null,
    [],
    {},
    { ...miio, ip: 'not-an-ip' },
    { ...miio, token: 'secret-invalid-token' },
    { ...miio, port: 123 },
  ]) {
    assert.throws(
      () => parseDeviceRegistration('miioToken', value),
      (error) => {
        assert.equal((error as Error).message, 'Invalid registration data for miioToken');
        return true;
      },
    );
  }
  for (const shareUrl of [
    'rusklimat://device-share/rusclimate/70/aabbccddeeff?token=0123456789abcdef0123456789abcdef',
    'rusklimat://device-share/rusclimate/69/aabbccddeeff?token=00000000000000000000000000000000',
    'rusklimat://device-share/rusclimate/69/aabbccddeeff?token=test-token',
    'https://example.com?token=secret',
    'rusklimat://device-share/rusclimate/69/id',
    'rusklimat://device-share/rusclimate/69/id?token=',
    'rusklimat://unrelated/rusclimate/69/id?token=secret',
  ]) {
    assert.throws(
      () => parseDeviceRegistration('hommynShareUrl', { shareUrl }),
      /Invalid registration data/,
    );
  }
});
