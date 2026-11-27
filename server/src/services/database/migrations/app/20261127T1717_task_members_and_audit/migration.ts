#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/317cf11f57056fdf9f3663f3b925ae35e7798a5eba3ddd39f54002419a4908fb/contract';
import endContract from '../../snapshots/317cf11f57056fdf9f3663f3b925ae35e7798a5eba3ddd39f54002419a4908fb/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/de0c17505fa31049f42a8e2d8e17c8afd1cef89b2e3f788ab6048916cff38ed1/contract';
import startContract from '../../snapshots/de0c17505fa31049f42a8e2d8e17c8afd1cef89b2e3f788ab6048916cff38ed1/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, primaryKey, sql } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      ...this.renameColumn({ schema: 'public', table: 'tasks', column: 'userId', to: 'createdBy' }),
      this.dropIndex({ schema: 'public', table: 'tasks', index: 'tasks_userId_idx' }),
      this.createTable({
        schema: 'public',
        table: 'taskUsers',
        columns: [
          col('taskId', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('userId', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
        ],
        constraints: [primaryKey(['taskId', 'userId'])],
      }),
      // The pre-upgrade list is empty; stop atomically if another database needs a membership backfill.
      this.addRequiredColumnToEmptyTable({
        schema: 'public', table: 'tasks', column: 'createdAt', type: 'timestamptz(3)',
      }),
      this.setDefault({
        schema: 'public',
        table: 'tasks',
        column: col('createdAt', 'timestamptz(3)', {
          notNull: true,
          default: fn(sql`now()`),
          codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'tasks',
        column: col('deletedAt', 'timestamptz(3)', {
          codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'tasks',
        column: col('deletedBy', 'uuid', { codecRef: { codecId: 'pg/uuid@1' } }),
      }),
      this.createIndex({
        schema: 'public',
        table: 'taskUsers',
        index: 'taskUsers_userId_taskId_idx',
        columns: ['userId', 'taskId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'tasks',
        index: 'tasks_createdBy_idx',
        columns: ['createdBy'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'taskUsers',
        foreignKey: {
          name: 'taskUsers_taskId_fkey',
          columns: ['taskId'],
          references: { schema: 'public', table: 'tasks', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'taskUsers',
        foreignKey: {
          name: 'taskUsers_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'users', columns: ['id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'tasks',
        foreignKey: {
          name: 'tasks_deletedBy_fkey',
          columns: ['deletedBy'],
          references: { schema: 'public', table: 'users', columns: ['id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
