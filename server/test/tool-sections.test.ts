import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { z } from 'zod';
import type { Database } from '../src/services/database';
import type { ToolCall } from '../src/services/llm';
import type { ToolOutcome, ToolSection } from '../src/services/llm-tools/registry';
import { withServiceResources } from './service-resources';

const REGISTRY_MODULE = new URL('../src/services/llm-tools/registry.ts', import.meta.url);
const REGISTRY = await import('../src/services/llm-tools/registry');
const CALCULATOR: ToolSection = {
  name: 'calculator',
  tools: [
    {
      name: 'calculate_total',
      description: 'Посчитать сумму.',
      schema: z.strictObject({ values: z.array(z.number()) }),
    },
  ],
  execute: calculate,
};
const NOTES: ToolSection = {
  name: 'notes',
  tools: [
    {
      name: 'read_note',
      description: 'Прочитать заметку.',
      schema: z.strictObject({ title: z.string() }),
    },
  ],
  execute: readNote,
};
const TOOLS = new Map(REGISTRY.TOOLS);
for (const section of [CALCULATOR, NOTES]) {
  for (const tool of section.tools) TOOLS.set(tool.name, { section, tool });
}
// Substitute the registry boundary; run the real shared validation, dispatch and journal code.
mock.module(REGISTRY_MODULE, { cache: true, namedExports: { ...REGISTRY, TOOLS } });
const { executeTools } = await import('../src/services/llm-tools/execute-tools');
const DEVICE_ID = '019ace9d-0000-7000-8000-000000000001';

test(
  'one batch dispatches home, calculator and notes tools with independent schemas',
  checkMixedBatch,
);
test(
  'invalid and unknown tools are journaled without executing or storing raw input',
  checkRejectedCalls,
);
test('a section failure is redacted and does not skip the next section', checkPartialFailure);
test('the batch limit and journal failures prevent further execution', checkExecutionLimits);

type Action = {
  id: string;
  sequence: number;
  service: string;
  operation: string;
  arguments: unknown;
  result?: ToolOutcome;
  error?: string | null;
};
class Journal {
  actions: Action[] = [];
  failUpdate = false;
  private current = '';
  select() {
    return this;
  }
  where({ id }: { id: string }) {
    this.current = id;
    return this;
  }
  async create(data: Omit<Action, 'id'>) {
    const action = { ...data, id: String(this.actions.length) };
    this.actions.push(action);
    return { id: action.id };
  }
  async update(data: Pick<Action, 'result' | 'error'>) {
    if (this.failUpdate) throw new Error('Journal unavailable');
    const action = this.actions.find((action) => action.id === this.current)!;
    Object.assign(action, data);
  }
}

async function calculate(_name: string, args: Record<string, unknown>): Promise<ToolOutcome> {
  const values = args.values as number[];
  if (values.includes(-1)) throw new Error('secret-api-key');
  const total = values.reduce((sum, value) => sum + value, 0);
  return { status: 'confirmed', reply: `Сумма ${total}.`, data: { values, result: { total } } };
}
async function readNote(_name: string, args: Record<string, unknown>): Promise<ToolOutcome> {
  return { status: 'confirmed', reply: `Заметка ${args.title}.`, data: ['Текст', null, true] };
}
function fixture(journal: Journal) {
  const device = { select: returnSelf, include: returnSelf, first: readDevice };
  return {
    orm: { public: { InteractionAction: journal, HomeDevice: device } },
  } as unknown as Database;
}
function returnSelf(this: unknown) {
  return this;
}
async function readDevice() {
  return {
    id: DEVICE_ID,
    displayName: 'Бризер',
    type: { code: 'smartmi-fresh-air' },
    room: { displayName: 'Комната' },
    registrationData: { token: 'private-token' },
  };
}
async function readState() {
  return { power: true };
}
function call(name: string, args: Record<string, unknown>): ToolCall {
  return { function: { name, arguments: args } };
}
async function run(journal: Journal, calls: ToolCall[]) {
  const db = fixture(journal);
  return withServiceResources({ db, driver: readState }, () => executeTools('interaction', calls));
}

async function checkMixedBatch() {
  const journal = new Journal();
  const calls = [
    call('smartmi_get_state', { deviceId: DEVICE_ID }),
    call('calculate_total', { values: [2, 3] }),
    call('read_note', { title: 'Покупки' }),
  ];
  const reply = await run(journal, calls);
  assert.match(reply, /Бризер.*включён.*Сумма 5.*Заметка Покупки/);
  const services = journal.actions.map((action) => action.service);
  const sequences = journal.actions.map((action) => action.sequence);
  assert.deepEqual(services, ['smartHome', 'calculator', 'notes']);
  assert.deepEqual(sequences, [2, 3, 4]);
  assert.deepEqual(journal.actions[0].result?.data, {
    deviceId: DEVICE_ID,
    state: { power: true },
  });
  assert.deepEqual(journal.actions[1].result?.data, { values: [2, 3], result: { total: 5 } });
  assert.deepEqual(journal.actions[2].result?.data, ['Текст', null, true]);
  const serialized = JSON.stringify(journal.actions);
  assert.doesNotMatch(serialized, /private-token/);
}

async function checkRejectedCalls() {
  const journal = new Journal();
  const calls = [
    call('calculate_total', { values: 'secret-argument' }),
    call('read_note', { title: 'Покупки', token: 'secret-argument' }),
    call('secret-tool-name', { token: 'secret-argument' }),
  ];
  const reply = await run(journal, calls);
  const statuses = journal.actions.map((action) => action.result?.status);
  const argumentsList = journal.actions.map((action) => action.arguments);
  assert.deepEqual(statuses, ['rejected', 'rejected', 'rejected']);
  assert.deepEqual(argumentsList, [{}, {}, {}]);
  assert.equal(journal.actions[2].service, 'llmTools');
  assert.equal(journal.actions[2].operation, 'unknown_tool');
  const serialized = JSON.stringify(journal.actions);
  assert.doesNotMatch(serialized, /secret-/);
  assert.doesNotMatch(reply, /Сумма|Заметка/);
}

async function checkPartialFailure() {
  const journal = new Journal();
  const calls = [
    call('calculate_total', { values: [-1] }),
    call('read_note', { title: 'Покупки' }),
  ];
  const reply = await run(journal, calls);
  assert.equal(journal.actions[0].result?.status, 'failed');
  assert.equal(journal.actions[0].result?.errorCode, 'internal_error');
  assert.equal(journal.actions[1].result?.status, 'confirmed');
  assert.match(reply, /Заметка Покупки/);
  const serialized = JSON.stringify(journal.actions);
  assert.doesNotMatch(serialized, /secret-api-key/);
  assert.doesNotMatch(reply, /secret-api-key/);
}

async function checkExecutionLimits() {
  const journal = new Journal();
  const command = call('read_note', { title: 'Покупки' });
  const calls = Array<ToolCall>(9).fill(command);
  const reply = await run(journal, calls);
  assert.match(reply, /до восьми/);
  assert.equal(journal.actions.length, 1);
  assert.equal(journal.actions[0].operation, 'reject_batch');
  assert.deepEqual(journal.actions[0].arguments, { count: 9 });
  journal.actions.length = 0;
  journal.failUpdate = true;
  const pending = run(journal, [command, command]);
  await assert.rejects(pending, /Journal unavailable/);
  assert.equal(journal.actions.length, 1);
}
