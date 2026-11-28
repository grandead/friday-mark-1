import type { Database } from '../src/services/database';
import type { GenerateResponse } from '../src/services/llm';
import type { DeviceDriver } from './service-resources';

import { withServiceResources } from './service-resources';

const { generateReply } = await import('../src/services/assistant/reply');

export function createAssistant(
  db: Database,
  generateResponse: GenerateResponse,
  tools?: { driver: DeviceDriver },
) {
  const resources = { db, generateResponse, driver: tools?.driver };
  return runAssistant.bind(null, resources);
}

async function runAssistant(
  resources: { db: Database; generateResponse: GenerateResponse; driver?: DeviceDriver },
  id: string,
  transcript: string,
) {
  await resources.db.orm.public.Interaction.select('id').where({ id }).update({ transcript });
  return withServiceResources(resources, () => generateReply(id));
}
