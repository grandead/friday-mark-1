import type { DeviceRegistrationType } from '@prisma/client';
import { z } from 'zod';
import type { ToolDefinition } from '../llm/types.js';
import { type DeviceCommand, DeviceCommandError, type DeviceDriver } from './driver.js';

export const selector = z.strictObject({
  device: z.string().trim().min(1).max(120),
  room: z.string().trim().min(1).max(120).optional(),
  home: z.string().trim().min(1).max(120).optional(),
});
export type DeviceSelector = z.infer<typeof selector>;
export const invalidCommandReply =
  'Не удалось разобрать команду. Укажите устройство, комнату и нужное действие.';
type Connection = Pick<DeviceCommand, 'model' | 'transport' | 'registrationData'>;
type State = Record<string, string | number | boolean | undefined>;

export type PreparedCommand = {
  selector: DeviceSelector;
  arguments: Record<string, z.infer<ReturnType<typeof z.json>>>;
  run(connection: Connection, driver: DeviceDriver): Promise<{ state: State; description: string }>;
};
export type ModelCommand = {
  definition: ToolDefinition;
  unavailableReply?: string;
  prepare(input: unknown): { ok: true; command: PreparedCommand } | { ok: false; reply: string };
};
export type DeviceModel = {
  code: string;
  transport: DeviceCommand['transport'];
  registrationType: DeviceRegistrationType;
  commands: readonly ModelCommand[];
  catalogue?: Record<string, string | number | boolean>;
};

// Each closure keeps command arguments and state typed to its own model.
export function commandsFor<S extends State>(stateSchema: z.ZodType<S>) {
  return function defineCommand<Shape extends z.ZodRawShape>(config: {
    name: string;
    description: string;
    operation: string;
    schema: z.ZodObject<Shape>;
    parameters?: ToolDefinition['function']['parameters'];
    unavailableReply?: string;
    invalidReply?: (error: z.ZodError) => string;
    confirm?: (state: S, args: z.infer<z.ZodObject<Shape>>) => boolean;
    describe: (state: S, args: z.infer<z.ZodObject<Shape>>) => string;
  }): ModelCommand {
    const inputSchema = selector.extend(config.schema.shape);
    return {
      definition: {
        type: 'function',
        function: {
          name: config.name,
          description: config.description,
          parameters: config.parameters ?? z.toJSONSchema(inputSchema),
        },
      },
      unavailableReply: config.unavailableReply,
      prepare(input) {
        const parsed = inputSchema.safeParse(input);
        if (!parsed.success)
          return { ok: false, reply: config.invalidReply?.(parsed.error) ?? invalidCommandReply };
        const args = config.schema.parse(
          Object.fromEntries(
            Object.keys(config.schema.shape).map((key) => [key, Reflect.get(parsed.data, key)]),
          ),
        );
        return {
          ok: true,
          command: {
            selector: selector.parse(
              Object.fromEntries(
                ['device', 'room', 'home'].map((key) => [key, Reflect.get(parsed.data, key)]),
              ),
            ),
            arguments: z.record(z.string(), z.json()).parse(parsed.data),
            async run(connection, driver) {
              const raw = await driver({
                ...connection,
                operation: config.operation,
                parameters: args,
              });
              const result = stateSchema.safeParse(raw);
              if (!result.success) throw new DeviceCommandError('invalid_device_state');
              const state = result.data;
              if (config.confirm && !config.confirm(state, args))
                throw new DeviceCommandError('not_confirmed');
              return { state, description: config.describe(state, args) };
            },
          },
        };
      },
    };
  };
}
