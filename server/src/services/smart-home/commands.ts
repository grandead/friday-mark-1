import { AppError } from '../../../shared/errors';
import { type Models, orm } from '../database';
import { DEVICE_ID_SCHEMA, type DeviceModel, type DeviceOperation } from './common';
import { DeviceCommandError } from './device-error';
import { DEVICE_MODELS } from './models';

type Command = { operation: string; [field: string]: unknown };
type RegisteredDevice = Pick<
  Models.public_HomeDevice,
  'id' | 'displayName' | 'registrationData'
> & {
  type: Pick<Models.public_HomeDeviceType, 'code'>;
  room: Pick<Models.public_Room, 'displayName'>;
};

export async function executeDeviceCommand(deviceId: string, command: Command) {
  const validId = DEVICE_ID_SCHEMA.safeParse(deviceId);
  if (!validId.success) throw new AppError('invalid_device_command');
  const device = await getDevice(deviceId);
  const { operation, ...parameters } = command;
  if (Object.hasOwn(parameters, 'deviceId')) throw new AppError('invalid_device_command');
  const { model, definition } = findOperation(device.type.code, operation);
  const args = definition.schema.safeParse({ ...parameters, deviceId });
  if (!args.success) throw new AppError('invalid_device_command');
  const result = await execute(device, model, definition, args.data);
  return result.state;
}

// Model-bound callers validate with this schema before journaling and execution.
export function getDeviceOperation(modelCode: string, operation: string) {
  const { model, definition } = findOperation(modelCode, operation);
  return { schema: definition.schema, execute: executeForModel.bind(null, model, definition) };
}

function findOperation(code: string, operation: string) {
  const model = DEVICE_MODELS.find((entry) => entry.code === code);
  if (!model || !Object.hasOwn(model.operations, operation))
    throw new DeviceCommandError('unsupported');
  return { model, definition: model.operations[operation] };
}

async function getDevice(id: string) {
  const device = await orm.HomeDevice.select('id', 'displayName', 'registrationData')
    .include('type', (type) => type.select('code'))
    .include('room', (room) => room.select('displayName'))
    .first({ id });
  if (!device) throw new AppError('entity_not_found');
  return device as RegisteredDevice;
}

async function executeForModel(
  model: DeviceModel,
  definition: DeviceOperation,
  args: { deviceId: string },
) {
  const device = await getDevice(args.deviceId);
  if (device.type.code !== model.code) throw new AppError('device_model_mismatch');
  return execute(device, model, definition, args);
}

async function execute(
  device: RegisteredDevice,
  model: DeviceModel,
  operation: DeviceOperation,
  args: { deviceId: string },
) {
  const connection = {
    model: model.code,
    transport: model.transport,
    registrationData: device.registrationData,
  };
  const location = { name: device.displayName, room: device.room.displayName };
  try {
    const result = await operation.execute(args, connection);
    const entries = Object.entries(result.state);
    const defined = entries.filter(isDefinedState);
    const state = Object.fromEntries(defined);
    return { ...location, state, description: result.description };
  } catch (error) {
    if (error instanceof DeviceCommandError) throw new DeviceCommandError(error.code, location);
    throw error;
  }
}

function isDefinedState(
  entry: [string, string | number | boolean | undefined],
): entry is [string, string | number | boolean] {
  return entry[1] !== undefined;
}
