import { DEVICE_ID as deviceId, USER_ID as userId } from '../src/config/identity';
import { type Database, db } from '../src/services/database';

const DEVICE_MODELS = [
  {
    code: 'xiaomi-smart-humidifier-2',
    displayName: 'Xiaomi Smart Humidifier 2',
    vendor: 'Xiaomi',
    model: 'Smart Humidifier 2',
    kind: 'humidifier',
    registrationType: 'miioToken',
  },
  {
    code: 'qingping-air-monitor-lite',
    displayName: 'Qingping Air Monitor Lite',
    vendor: 'Qingping',
    model: 'Air Monitor Lite',
    kind: 'airMonitor',
    registrationType: 'miioToken',
  },
  {
    code: 'smartmi-fresh-air',
    displayName: 'Xiaomi Smartmi Fresh Air',
    vendor: 'Smartmi',
    model: 'Fresh Air',
    kind: 'breezer',
    registrationType: 'miioToken',
  },
  {
    code: 'ballu-oneair-asp-100',
    displayName: 'Ballu ONEAIR ASP-100',
    vendor: 'Ballu',
    model: 'ONEAIR ASP-100',
    kind: 'breezer',
    registrationType: 'hommynShareUrl',
  },
] as const;

async function seedRecords(tx: Pick<Database, 'orm'>) {
  const orm = tx.orm.public;
  const device = await orm.Device.select('id').first({ id: deviceId });
  if (!device) await orm.Device.select('id').create({ id: deviceId, displayName: 'Пятница' });
  const user = await orm.User.select('id').first({ id: userId });
  if (!user) await orm.User.select('id').create({ id: userId, displayName: 'Кирилл' });
  for (const model of DEVICE_MODELS) {
    const existing = await orm.HomeDeviceType.select('id').first({ code: model.code });
    if (!existing) await orm.HomeDeviceType.select('id').create(model);
  }
}
try {
  await db.transaction(seedRecords);
} finally {
  await db.close();
}
