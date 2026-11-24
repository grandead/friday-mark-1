import type { PrismaClient } from '@prisma/client';
import { AppError, diagnosticError } from '../../../shared/errors.js';
import { userErrors } from '../../../shared/userErrors.ru.js';
import type { ToolCall } from '../llm/types.js';
import { parseDeviceRegistration } from '../validation/homeDevice.js';
import { DeviceCommandError, type DeviceDriver } from './driver.js';
import type { ModelRegistry } from './registry.js';
import { resolveDevice } from './resolveDevice.js';

export function createCommandExecutor(
  db: PrismaClient,
  driver: DeviceDriver,
  registry: ModelRegistry,
) {
  return async (interactionId: string, sequence: number, call: ToolCall): Promise<string> => {
    const name = call.function.name;
    const publicCommand = registry.commands.get(name);
    if (!publicCommand) return 'Эта команда пока не поддерживается.';
    const parsed = publicCommand.prepare(call.function.arguments);
    if (!parsed.ok) return parsed.reply;
    const action = await db.interactionAction.create({
      data: {
        interactionId,
        sequence,
        initiator: 'llm',
        service: 'smartHome',
        operation: name,
        arguments: parsed.command.arguments,
      },
    });
    async function finish(reply: string) {
      await db.interactionAction.update({
        where: { id: action.id },
        data: { result: { reply, executed: false } },
      });
      return reply;
    }
    const resolved = await resolveDevice(db, parsed.command.selector);
    if (!resolved.ok) return finish(resolved.reply);
    const { device } = resolved;
    const model = registry.models.get(device.type.code);
    if (!model) return finish('Управление этой моделью пока не подключено.');
    const command = model.commands.find((command) => command.definition.function.name === name);
    if (!command)
      return finish(
        publicCommand.unavailableReply ?? 'Эта команда недоступна для выбранной модели.',
      );
    const prepared = command.prepare(call.function.arguments);
    if (!prepared.ok) return finish(prepared.reply);
    const location = `«${device.displayName}», комната «${device.room.displayName}»`;
    let outcome: Awaited<ReturnType<typeof prepared.command.run>>;
    try {
      if (device.type.registrationType !== model.registrationType)
        throw new AppError('internal_error');
      const record = await db.homeDevice.findUniqueOrThrow({
        where: { id: device.id },
        select: { registrationData: true },
      });
      outcome = await prepared.command.run(
        {
          model: model.code,
          transport: model.transport,
          registrationData: parseDeviceRegistration(
            model.registrationType,
            record.registrationData,
          ),
        },
        driver,
      );
    } catch (cause) {
      // Only the transport may classify a failure as device-related. Never expose raw exceptions.
      const error = cause instanceof DeviceCommandError ? cause : new AppError('internal_error');
      const reply = `${location}: ${userErrors[error.code]}`;
      await db.interactionAction.update({
        where: { id: action.id },
        data: {
          error: diagnosticError(error),
          result: { deviceId: device.id, errorCode: error.code, reply, confirmed: false },
        },
      });
      return reply;
    }
    // Journal failures must propagate as infrastructure failures, not failed device commands.
    const reply = `${location}: ${outcome.description}`;
    await db.interactionAction.update({
      where: { id: action.id },
      data: { result: { deviceId: device.id, state: outcome.state, reply, executed: true } },
    });
    return reply;
  };
}
