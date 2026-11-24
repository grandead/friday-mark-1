import { isDeepStrictEqual } from 'node:util';
import type { DeviceModel, ModelCommand } from './model.js';
import { balluAsp100 } from './models/balluAsp100.js';
import { smartHumidifier2 } from './models/smartHumidifier2.js';
import { smartmiFreshAir } from './models/smartmiFreshAir.js';

export function createModelRegistry(models: readonly DeviceModel[]) {
  const byCode = new Map<string, DeviceModel>();
  const commands = new Map<string, ModelCommand>();
  for (const model of models) {
    if (byCode.has(model.code)) throw new Error(`Duplicate device model: ${model.code}`);
    byCode.set(model.code, model);
    const names = new Set<string>();
    for (const command of model.commands) {
      const name = command.definition.function.name;
      if (names.has(name)) throw new Error(`Duplicate command ${name} in model ${model.code}`);
      names.add(name);
      const existing = commands.get(name);
      if (existing && !isDeepStrictEqual(existing.definition, command.definition))
        throw new Error(`Conflicting tool definition: ${name}`);
      if (!existing) commands.set(name, command);
    }
  }
  return {
    models: byCode,
    commands,
    definitions: [...commands.values()].map((command) => command.definition),
  };
}
export const homeModels = createModelRegistry([smartHumidifier2, smartmiFreshAir, balluAsp100]);
export type ModelRegistry = ReturnType<typeof createModelRegistry>;
