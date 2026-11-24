import assert from 'node:assert/strict';
import test from 'node:test';
import { v7, version } from 'uuid';
import { createHomeDevice } from '../src/services/smartHome/devices.js';
import { parseDeviceRegistration } from '../src/services/validation/homeDevice.js';
import { createTestDatabase } from './database.js';

const miio = { ip: '192.168.1.12', token: 'abcdef0123456789abcdef0123456789' };
const hommyn = {
  shareUrl: 'rusklimat://device-share/rusclimate/69/aabbccddeeff?token=test-token&name=Ballu',
};

test('smart home migration seeds the model catalogue and keeps homes isolated', async (t) => {
  const database = await createTestDatabase();
  t.after(() => database.close());
  const db = database.db;
  const types = await db.homeDeviceType.findMany({ orderBy: { code: 'asc' } });
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
  assert.equal(await db.home.count(), 0);
  assert.equal(await db.homeDevice.count(), 0);
  // Existing voice terminals still live in their original table.
  assert.equal(await db.device.count(), 1);
  const first = await db.home.create({ data: { displayName: 'Квартира' } });
  const second = await db.home.create({ data: { displayName: 'Дача' } });
  const rooms = await Promise.all(
    [first, second].map((home) =>
      db.room.create({ data: { homeId: home.id, displayName: 'Спальня' } }),
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
  const tree = await db.home.findUniqueOrThrow({
    where: { id: first.id },
    include: { rooms: { include: { devices: true } } },
  });
  assert.deepEqual(
    tree.rooms[0].devices.map((device) => device.id),
    [humidifier.id],
  );
  assert.deepEqual(tree.rooms[0].devices[0].registrationData, miio);
  assert.deepEqual(
    (await db.homeDevice.findUniqueOrThrow({ where: { id: ballu.id } })).registrationData,
    hommyn,
  );

  await assert.rejects(
    createHomeDevice(db, {
      roomId: rooms[0].id,
      typeId: balluType.id,
      displayName: 'Wrong format',
      registrationData: miio,
    }),
    /Invalid registration data/,
  );
  await assert.rejects(
    createHomeDevice(db, {
      roomId: rooms[0].id,
      typeId: humidifierType.id,
      displayName: 'Wrong format',
      registrationData: hommyn,
    }),
    /Invalid registration data/,
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
    db.homeDevice.create({
      data: {
        roomId: rooms[0].id,
        typeId: humidifierType.id,
        displayName: 'Array instead of object',
        registrationData: [],
      },
    }),
  );
  await assert.rejects(db.home.create({ data: { displayName: '   ' } }));
  await assert.rejects(db.home.delete({ where: { id: first.id } }));
  await assert.rejects(db.room.delete({ where: { id: rooms[0].id } }));
  await assert.rejects(db.homeDeviceType.delete({ where: { id: humidifierType.id } }));
  assert.equal(await db.homeDevice.count(), 2);
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
