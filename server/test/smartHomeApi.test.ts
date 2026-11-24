import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { v7 } from 'uuid';
import { buildApp } from '../src/app.js';
import { createTestDatabase } from './database.js';

test('smart home API creates a nested tree and never returns connection credentials', async (t) => {
  const database = await createTestDatabase();
  const recordingsDir = await mkdtemp(join(tmpdir(), 'friday-home-api-'));
  const app = await buildApp({
    db: database.db,
    recordingsDir,
    transcribe: async () => '',
    log: () => {},
  });
  t.after(async () => {
    await app.close();
    await database.close();
    await rm(recordingsDir, { recursive: true, force: true });
  });
  const post = (path: string, payload: object) =>
    app.inject({ method: 'POST', url: `/api/smart-home/${path}`, payload });
  const initial = (await app.inject('/api/smart-home')).json();
  assert.deepEqual(initial.homes, []);
  assert.equal(initial.deviceTypes.length, 4);
  const homeResponse = await post('homes', { displayName: ' Квартира ' });
  assert.equal(homeResponse.statusCode, 201);
  const home = homeResponse.json();
  assert.equal(home.displayName, 'Квартира');
  const other = (await post('homes', { displayName: 'Дача' })).json();
  const roomResponse = await post('rooms', { homeId: home.id, displayName: 'Спальня' });
  assert.equal(roomResponse.statusCode, 201);
  const room = roomResponse.json();
  const miio = { ip: '192.168.1.12', token: 'abcdef0123456789abcdef0123456789' };
  const shareUrl = 'rusklimat://device-share/rusclimate/69/aabbcc?token=private-test-token';
  const types = initial.deviceTypes as Array<{ id: string; registrationType: string }>;
  for (const [registrationType, registrationData] of [
    ['miioToken', miio],
    ['hommynShareUrl', { shareUrl }],
  ] as const) {
    const typeId = types.find((type) => type.registrationType === registrationType)!.id;
    const response = await post('devices', {
      roomId: room.id,
      typeId,
      displayName: 'Прибор',
      registrationData,
    });
    assert.equal(response.statusCode, 201, response.body);
    assert.equal('registrationData' in response.json(), false);
    const stored = await database.db.homeDevice.findUniqueOrThrow({
      where: { id: response.json().id },
    });
    assert.deepEqual(stored.registrationData, registrationData);
  }
  const treeResponse = await app.inject('/api/smart-home');
  const tree = treeResponse.json();
  assert.equal(tree.homes.find((h: { id: string }) => h.id === home.id).rooms[0].devices.length, 2);
  assert.deepEqual(tree.homes.find((h: { id: string }) => h.id === other.id).rooms, []);
  for (const secret of ['registrationData', miio.token, miio.ip, shareUrl])
    assert.equal(treeResponse.body.includes(secret), false);

  for (const displayName of ['', '   ', 'a'.repeat(121)])
    assert.equal((await post('homes', { displayName })).statusCode, 400);
  assert.equal((await post('rooms', { homeId: v7(), displayName: 'Missing' })).statusCode, 404);
  const input = {
    roomId: room.id,
    typeId: types.find((type) => type.registrationType === 'miioToken')!.id,
    displayName: 'Invalid',
    registrationData: miio,
  };
  assert.equal((await post('devices', { ...input, typeId: v7() })).statusCode, 404);
  assert.equal((await post('devices', { ...input, roomId: v7() })).statusCode, 404);
  const invalid = await post('devices', {
    ...input,
    registrationData: { ...miio, ip: 'invalid-ip' },
  });
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.body.includes(miio.token), false);
  assert.match(invalid.json().message, /IPv4/);
  assert.equal(invalid.json().code, 'invalid_miio_registration');
  assert.doesNotMatch(invalid.body, /[А-Яа-яЁё]/);
  const invalidHome = await post('homes', { displayName: '' });
  assert.equal(invalidHome.json().code, 'invalid_form');
  assert.doesNotMatch(invalidHome.body, /[А-Яа-яЁё]/);
  assert.equal(
    (await post('devices', { ...input, registrationType: 'hommynShareUrl' })).statusCode,
    400,
  );
  assert.equal(await database.db.homeDevice.count(), 2);
});
