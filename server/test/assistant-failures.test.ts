import assert from 'node:assert/strict';
import test from 'node:test';
import type { Database } from '../src/services/database';
import type { ModelReply } from '../src/services/llm';
import { withServiceResources } from './service-resources';

const { generateReply } = await import('../src/services/assistant/reply');
const DEVICE_ID = '019ace9d-0000-7000-8000-000000000001';
const REPLY: ModelReply = {
  text: 'Hello',
  model: 'test',
  inputTokens: 1,
  outputTokens: 1,
  durationMs: 1,
};

test('tool journal failure does not mark a successful chat as failed', checkToolJournalFailure);
test(
  'translation journal failure propagates without rewriting the chat or returning a fallback',
  checkTranslationJournalFailure,
);

async function checkToolJournalFailure() {
  const journal = new Journal();
  const reply = {
    ...REPLY,
    toolCalls: [{ function: { name: 'smartmi_get_state', arguments: { deviceId: DEVICE_ID } } }],
  };
  const db = fixture(journal);
  const resources = {
    db,
    generateResponse: async () => reply,
    driver: async () => ({ power: true }),
  };
  const pending = withServiceResources(resources, () => generateReply('interaction'));
  await assert.rejects(pending, /Journal unavailable/);
  assert.deepEqual(journal.operations, ['chat', 'smartmi_get_state']);
  assert.equal(journal.writes.length, 1);
  assert.equal(journal.writes[0].error, undefined);
  assert.ok(journal.writes[0].result);
}

async function checkTranslationJournalFailure() {
  const journal = new Journal();
  const db = fixture(journal);
  const resources = { db, generateResponse: journal.generate.bind(journal) };
  const pending = withServiceResources(resources, () => generateReply('interaction'));
  await assert.rejects(pending, /Journal unavailable/);
  assert.deepEqual(journal.operations, ['chat', 'translate_reply']);
  assert.equal(journal.writes.length, 1);
  assert.equal(journal.writes[0].error, undefined);
}

class Journal {
  operations: string[] = [];
  writes: { result?: unknown; error?: string }[] = [];
  private current = '';
  private generated = 0;

  select() {
    return this;
  }
  where({ id }: { id: string }) {
    this.current = id;
    return this;
  }
  async create({ operation }: { operation: string }) {
    this.operations.push(operation);
    return { id: operation };
  }
  async update(data: { result?: unknown; error?: string }) {
    if (this.current !== 'chat') throw new Error('Journal unavailable');
    this.writes.push(data);
  }
  async generate() {
    this.generated++;
    return { ...REPLY, text: this.generated === 1 ? 'Hello' : 'Привет' };
  }
}

function fixture(journal: Journal) {
  const interaction = {
    select: returnSelf,
    include: returnSelf,
    where: returnSelf,
    orderBy: returnSelf,
    cursor: returnSelf,
    limit: returnSelf,
    all: emptyRows,
    firstOrThrow: currentInteraction,
  };
  const devices = { select: returnSelf, include: returnSelf, all: emptyRows, first: device };
  return {
    orm: { public: { Interaction: interaction, HomeDevice: devices, InteractionAction: journal } },
  } as unknown as Database;
}
function returnSelf(this: unknown) {
  return this;
}
async function emptyRows() {
  return [];
}
async function currentInteraction() {
  return {
    id: 'interaction',
    transcript: 'Привет',
    userId: 'user',
    startedAt: new Date(),
    user: { displayName: 'User' },
  };
}
async function device() {
  return {
    id: DEVICE_ID,
    displayName: 'Бризер',
    type: { code: 'smartmi-fresh-air' },
    room: { displayName: 'Комната' },
    registrationData: {},
  };
}
