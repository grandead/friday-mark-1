import assert from 'node:assert/strict';
import test from 'node:test';
import { db } from '../src/services/database';
import { getPendingInteractionCount } from '../src/services/interactions';
import { executeTools, getToolContext, TOOL_DEFINITIONS } from '../src/services/llm-tools';

test('tool service exposes static definitions and direct functions without requests', async () => {
  assert.equal(typeof executeTools, 'function');
  assert.equal(typeof getToolContext, 'function');
  assert.equal(TOOL_DEFINITIONS.length, 37);
  const pending = getPendingInteractionCount();
  assert.equal(pending, 0);
  await db.close();
});
