import { type Models, orm } from '../database';

type DeviceMetadata = Pick<Models.public_HomeDevice, 'id' | 'displayName'> & {
  type: Pick<Models.public_HomeDeviceType, 'code'>;
  room: Pick<Models.public_Room, 'displayName'> & {
    home: Pick<Models.public_Home, 'displayName'>;
  };
};

export async function listHomeDevices() {
  const devices = await orm.HomeDevice.select('id', 'displayName')
    .include('type', (type) => type.select('code'))
    .include('room', selectRoom)
    .all();
  const metadata = devices as DeviceMetadata[];
  return metadata.map(deviceInfo);
}

function deviceInfo(device: DeviceMetadata) {
  return {
    id: device.id,
    name: device.displayName,
    room: device.room.displayName,
    home: device.room.home.displayName,
    model: device.type.code,
  };
}

function selectRoom(room: Pick<typeof orm.Room, 'select'>) {
  return room.select('displayName').include('home', (home) => home.select('displayName'));
}
