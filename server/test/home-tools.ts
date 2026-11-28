import type { Database } from '../src/services/database';
import type { ToolCall } from '../src/services/llm';
import type { DeviceDriver } from './service-resources';

import { withServiceResources } from './service-resources';

const { TOOL_DEFINITIONS, executeTools, getToolContext } = await import(
  '../src/services/llm-tools'
);
const { getHomeContext } = await import('../src/services/llm-tools/smart-home');
const { HOME_TOOLS } = await import('../src/services/llm-tools/smart-home/tools');
const { executeTool } = await import('../src/services/llm-tools/execute-tools');

export const DEVICE_TOOLS = new Map<string, (typeof HOME_TOOLS)[number]>(
  HOME_TOOLS.map((tool) => [tool.name, tool]),
);

export async function runHomeOperation(
  tool: (typeof HOME_TOOLS)[number],
  input: Record<string, unknown>,
) {
  const { deviceId, ...args } = tool.schema.parse(input);
  const state = await tool.run({ ip: '192.0.2.1', token: 'mock-token' }, args);
  const description = tool.describe(state, args);
  return { state, description };
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
