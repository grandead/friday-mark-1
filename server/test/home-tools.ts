import type { Database } from '../src/services/database';
import type { ToolCall } from '../src/services/llm';
import type { DeviceDriver } from '../src/services/smart-home/driver';
import { withServiceResources } from './service-resources';

const { TOOL_DEFINITIONS, executeTools, getToolContext } = await import(
  '../src/services/llm-tools'
);
const { getHomeContext } = await import('../src/services/llm-tools/smart-home');
const { VOICE_MODELS } = await import('../src/services/llm-tools/smart-home/tools');
const { executeTool } = await import('../src/services/llm-tools/execute-tools');

const { DEVICE_MODELS } = await import('../src/services/smart-home/models');
type Model = (typeof DEVICE_MODELS)[number];
type ModelTool = Model['operations'][string];
export const DEVICE_TOOLS = new Map<string, { model: Model; tool: ModelTool }>();
for (const voice of VOICE_MODELS) {
  const model = DEVICE_MODELS.find((entry) => entry.code === voice.code)!;
  for (const tool of voice.tools) {
    DEVICE_TOOLS.set(tool.name, { model, tool: model.operations[tool.operation] });
  }
}

type CatalogueDevice = {
  id: string;
  name: string;
  room: string;
  home: string;
  model: string;
  commands: string[];
};

async function readCatalogue(): Promise<CatalogueDevice[]> {
  const context = await getHomeContext();
  const marker = 'Каталог устройств: ';
  const start = context.indexOf(marker);
  if (start < 0) throw new Error('Device catalogue is missing from the LLM context');
  const json = context.slice(start + marker.length);
  return JSON.parse(json);
}

export function createHomeTools(db: Database, driver: DeviceDriver) {
  const resources = { db, driver };
  return {
    driver,
    definitions: TOOL_DEFINITIONS,
    context: () => withServiceResources(resources, getToolContext),
    catalogue: () => withServiceResources(resources, readCatalogue),
    execute: (id: string, sequence: number, call: ToolCall) =>
      withServiceResources(resources, () => executeTool(id, sequence, call)),
    executeAll: (id: string, calls: ToolCall[]) =>
      withServiceResources(resources, () => executeTools(id, calls)),
  };
}
