import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { v7 } from 'uuid';
import { type ErrorCode, errorResponse } from '../shared/errors';
import { USER_ID } from '../src/config/identity';
import { publish } from '../src/services/signals';
import { createTestDatabase } from './database';
import { withServiceResources } from './service-resources';

const { GET, POST } = await import('../src/app/api/tasks/route');
const { GET: liveTasks } = await import('../src/app/api/tasks/live/route');
const { PATCH, DELETE } = await import('../src/app/api/tasks/[id]/route');

test('task API scopes writes to the owner and validates partial updates', testTaskRoutes);
test(
  'task events and snapshots agree on creation order, status and deletion',
  { timeout: 20000 },
  testTaskFeed,
);

async function testTaskFeed(t: TestContext) {
  const database = await createTestDatabase();
  t.after(() => database.close());
  const { db } = database;
  const other = await db.orm.public.User.select('id').create({ displayName: 'Другой' });
  const foreignTask = await db.orm.public.Task.select('id').create({
    createdBy: USER_ID,
    members: (members) => members.create({ userId: other.id }),
    title: 'Чужая задача',
  });
  await withServiceResources({ db }, () => checkTaskFeed(foreignTask));
}

async function checkTaskFeed(foreignTask: { id: string }) {
  const abort = new AbortController();
  const request = new Request('http://localhost/api/tasks/live', { signal: abort.signal });
  const response = liveTasks(request);
  const reader = response.body!.getReader();
  try {
    await reader.read();
    // Neither foreign event may reach this user's stream before the first visible task.
    publish('task.updated', { id: foreignTask.id });
    publish('task.deleted', foreignTask);
    const first = await post({ title: 'Яблоки' });
    const firstTask = await first.json();
    await assertTaskEvent(reader, firstTask.id, 'Pending');
    const second = await post({ title: 'Апельсины' });
    const secondTask = await second.json();
    await assertTaskEvent(reader, secondTask.id, 'Pending');
    await mutate('PATCH', firstTask.id, '{"status":"Done"}');
    await assertTaskEvent(reader, firstTask.id, 'Done');
    const list = await GET();
    const tasks = await list.json();
    const summary = tasks.map((task: { title: string; status: string }) => [
      task.title,
      task.status,
    ]);
    assert.deepEqual(summary, [
      ['Яблоки', 'Done'],
      ['Апельсины', 'Pending'],
    ]);
    await mutate('DELETE', firstTask.id);
    await assertTaskEvent(reader, firstTask.id, null);
    const latest = await GET();
    const remaining = await latest.json();
    const ids = remaining.map((task: { id: string }) => task.id);
    assert.deepEqual(ids, [secondTask.id]);
  } finally {
    abort.abort();
    await reader.cancel();
  }
}

async function assertTaskEvent(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  id: string,
  status: string | null,
) {
  const chunk = await reader.read();
  const decoder = new TextDecoder();
  const frame = decoder.decode(chunk.value);
  const [event, data] = frame.trimEnd().split('\n');
  assert.equal(event, status === null ? 'event: task.deleted' : 'event: task.updated');
  const json = data.slice('data: '.length);
  const change = JSON.parse(json);
  assert.equal(change.id, id);
  if (status === null) assert.equal(change.task, null);
  else assert.equal(change.task.status, status);
}

async function testTaskRoutes(t: TestContext) {
  const database = await createTestDatabase();
  t.after(() => database.close());
  const { db } = database;
  const users = db.orm.public.User.select('id');
  const other = await users.create({ displayName: 'Иван' });
  const otherTask = await db.orm.public.Task.select('id').create({
    createdBy: other.id,
    members: (members) => members.create({ userId: other.id }),
    title: 'Чужая задача',
  });
  await withServiceResources({ db }, () => checkTaskLifecycle(other.id, otherTask.id));
  const ownTask = await db.orm.public.Task.select('id', 'createdBy', 'deletedBy', 'deletedAt')
    .include('members', (members) => members.select('userId'))
    .firstOrThrow({ title: 'Купить кофе' });
  assert.equal(ownTask.createdBy, USER_ID);
  assert.equal(ownTask.deletedBy, USER_ID);
  assert.ok(ownTask.deletedAt instanceof Date);
  const memberIds = ownTask.members.map((member) => member.userId).sort();
  const expectedIds = [USER_ID, other.id].sort();
  assert.deepEqual(memberIds, expectedIds);
  const missingMember = v7();
  const invalid = await withServiceResources({ db }, () =>
    post({ title: 'Missing member', userIds: [missingMember] }),
  );
  await assertApiError(invalid, 404, 'user_not_found');
  const partial = await db.orm.public.Task.select('id').first({ title: 'Missing member' });
  assert.equal(partial, null);
  const shared = await db.orm.public.Task.select('id').create({
    title: 'Общая задача',
    createdBy: other.id,
    members: (members) => members.create([{ userId: other.id }, { userId: USER_ID }]),
  });
  await withServiceResources({ db }, () => checkSharedTask(shared.id));
  const archived = await db.orm.public.Task.select('createdBy', 'deletedAt', 'deletedBy')
    .include('members', (members) => members.select('userId'))
    .firstOrThrow({ id: shared.id });
  assert.equal(archived.createdBy, other.id);
  assert.equal(archived.deletedBy, USER_ID);
  assert.ok(archived.deletedAt instanceof Date);
  assert.equal(archived.members.length, 2);
}

async function checkSharedTask(id: string) {
  const abort = new AbortController();
  const request = new Request('http://localhost/api/tasks/live', { signal: abort.signal });
  const response = liveTasks(request);
  const reader = response.body!.getReader();
  try {
    await reader.read();
    const changed = await mutate('PATCH', id, '{"status":"Done"}');
    assert.equal(changed.status, 200);
    await assertTaskEvent(reader, id, 'Done');
    const removed = await mutate('DELETE', id);
    assert.equal(removed.status, 204);
    await assertTaskEvent(reader, id, null);
    const repeated = await mutate('DELETE', id);
    await assertApiError(repeated, 404, 'task_not_found');
    const stale = await mutate('PATCH', id, '{"title":"Повтор"}');
    await assertApiError(stale, 404, 'task_not_found');
  } finally {
    abort.abort();
    await reader.cancel();
  }
}

function post(payload: unknown) {
  const url = 'http://localhost/api/tasks';
  const body = JSON.stringify(payload);
  const request = new Request(url, { method: 'POST', body });
  return POST(request);
}

function mutate(method: 'PATCH' | 'DELETE', id: string, body?: string, query = '') {
  const url = `http://localhost/api/tasks/${id}${query}`;
  const request = new Request(url, { method, body });
  const params = Promise.resolve({ id });
  return method === 'PATCH' ? PATCH(request, { params }) : DELETE(request, { params });
}

async function assertApiError(response: Response, status: number, code: ErrorCode) {
  const body = await response.json();
  const expected = errorResponse(code);
  assert.equal(response.status, status);
  assert.deepEqual(body, expected);
}

async function checkTaskLifecycle(otherId: string, otherTaskId: string) {
  const created = await post({ title: ' Купить чай ', userIds: [otherId, USER_ID, otherId] });
  assert.equal(created.status, 201);
  const task = await created.json();
  const { id } = task;
  assert.ok(Number.isFinite(Date.parse(task.createdAt)));
  assert.deepEqual(task, {
    id,
    createdBy: USER_ID,
    createdAt: task.createdAt,
    title: 'Купить чай',
    description: null,
    status: 'Pending',
  });

  await checkInvalidRequests(otherId, otherTaskId, id);

  const updated = await mutate('PATCH', id, '{"description":"Зелёный","status":"Done"}');
  assert.equal(updated.status, 200);
  const done = await updated.json();
  assert.deepEqual(done, { ...task, description: 'Зелёный', status: 'Done' });
  const reopened = await mutate(
    'PATCH',
    id,
    '{"title":" Купить кофе ","description":null,"status":"Pending"}',
  );
  const pending = await reopened.json();
  assert.deepEqual(pending, { ...task, title: 'Купить кофе' });

  const deleted = await mutate('DELETE', id);
  assert.equal(deleted.status, 204);
  const body = await deleted.text();
  assert.equal(body, '');
  const repeatedDelete = await mutate('DELETE', id);
  await assertApiError(repeatedDelete, 404, 'task_not_found');
  const missingTask = await mutate('PATCH', id, '{"status":"Done"}');
  await assertApiError(missingTask, 404, 'task_not_found');
}

async function checkInvalidRequests(otherId: string, otherTaskId: string, id: string) {
  for (const payload of [
    { title: ' ' },
    { title: 'a'.repeat(121) },
    { title: 'a', userId: otherId },
    { title: 'a', createdBy: otherId },
    { title: 'a', deletedBy: otherId },
    { title: 'a', status: 'Done' },
  ]) {
    const response = await post(payload);
    await assertApiError(response, 400, 'invalid_task_request');
  }
  for (const method of ['PATCH', 'DELETE'] as const) {
    const body = method === 'PATCH' ? '{"title":"Wrong owner"}' : undefined;
    const wrongOwner = await mutate(method, otherTaskId, body, `?userId=${otherId}`);
    await assertApiError(wrongOwner, 404, 'task_not_found');
    const invalidId = await mutate(method, 'invalid', body);
    await assertApiError(invalidId, 400, 'invalid_task_request');
  }
  for (const invalid of [
    '{',
    '{}',
    '{"title":"   "}',
    '{"status":"Unknown"}',
    '{"userId":"other"}',
    '{"description":5}',
  ]) {
    const response = await mutate('PATCH', id, invalid);
    await assertApiError(response, 400, 'invalid_task_request');
  }
}
