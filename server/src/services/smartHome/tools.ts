import type { PrismaClient } from '@prisma/client';
import type { DeviceDriver } from './driver.js';
import { createCommandExecutor } from './executor.js';
import { homeModels, type ModelRegistry } from './registry.js';

export const homeToolDefinitions = homeModels.definitions;
export type HomeTools = ReturnType<typeof createHomeTools>;
export function createHomeTools(
  db: PrismaClient,
  driver: DeviceDriver,
  registry: ModelRegistry = homeModels,
) {
  return {
    definitions: registry.definitions,
    async catalogue() {
      const devices = await db.homeDevice.findMany({
        select: {
          displayName: true,
          type: { select: { code: true, displayName: true } },
          room: { select: { displayName: true, home: { select: { displayName: true } } } },
        },
      });
      return devices.map((device) => {
        const model = registry.models.get(device.type.code);
        return {
          device: device.displayName,
          room: device.room.displayName,
          home: device.room.home.displayName,
          model: device.type.displayName,
          commands: model?.commands.map((command) => command.definition.function.name) ?? [],
          ...model?.catalogue,
        };
      });
    },
    execute: createCommandExecutor(db, driver, registry),
  };
}
