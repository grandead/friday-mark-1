import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createTestDatabase } from './database';

test('tasks support multiple members and move from Pending to Done', async (t) => {
  const database = await createTestDatabase();
  t.after(() => database.close());
  const { User, Task } = database.db.orm.public;
  const users = User.select('id');
  const tasks = Task.select('id', 'description', 'status');
  const first = await users.create({ displayName: 'Анна' });
  const second = await users.create({ displayName: 'Иван' });
  const title = 'Купить продукты';
  const task = await tasks.create({
    createdBy: first.id,
    title,
    members: (m) => m.create([{ userId: first.id }, { userId: second.id }]),
  });
  const other = await tasks.create({
    createdBy: second.id,
    title,
    description: 'Молоко',
    members: (m) => m.create({ userId: second.id }),
  });
  assert.equal(task.description, null);
  assert.equal(task.status, 'Pending');
  assert.equal(other.description, 'Молоко');

  await tasks.where({ id: task.id }).update({ status: 'Done' });
  const members = database.db.orm.public.TaskUser.select('taskId').orderBy((r) => r.taskId.asc());
  const firstList = await members.where({ userId: first.id }).all();
  const secondList = await members.where({ userId: second.id }).all();
  assert.deepEqual(firstList, [{ taskId: task.id }]);
  assert.deepEqual(secondList, [{ taskId: task.id }, { taskId: other.id }]);

  await assert.rejects(users.where({ id: first.id }).delete());
  await assert.rejects(tasks.create({ createdBy: randomUUID(), title }));
  await assert.rejects(
    // @ts-expect-error Exercise the database constraint with an unsupported status.
    tasks.where({ id: task.id }).update({ status: 'Cancelled' }),
  );
});
