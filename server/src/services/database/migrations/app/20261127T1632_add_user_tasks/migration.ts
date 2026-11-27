#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/82a336459fda64bde03567c39393c2bd6c06d61ff1ad0821e52dc69b66ca7f06/contract';
import startContract from '../../snapshots/82a336459fda64bde03567c39393c2bd6c06d61ff1ad0821e52dc69b66ca7f06/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/de0c17505fa31049f42a8e2d8e17c8afd1cef89b2e3f788ab6048916cff38ed1/contract';
import endContract from '../../snapshots/de0c17505fa31049f42a8e2d8e17c8afd1cef89b2e3f788ab6048916cff38ed1/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  col,
  fn,
  lit,
  primaryKey,
  sql,
} from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createNativeEnumType({
        schema: 'public',
        typeName: 'TaskStatus',
        members: ['Pending', 'Done'],
      }),
      this.createTable({
        schema: 'public',
        table: 'tasks',
        columns: [
          col('description', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'uuid', {
            notNull: true,
            default: fn(sql`uuidv7()`),
            codecRef: { codecId: 'pg/uuid@1' },
          }),
          col('status', '"TaskStatus"', {
            notNull: true,
            default: lit('Pending'),
            codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'TaskStatus' } },
          }),
          col('title', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('userId', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createIndex({
        schema: 'public',
        table: 'tasks',
        index: 'tasks_userId_idx',
        columns: ['userId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'tasks',
        foreignKey: {
          name: 'tasks_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'users', columns: ['id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
