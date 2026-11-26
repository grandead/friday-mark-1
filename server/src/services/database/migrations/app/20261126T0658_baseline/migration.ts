#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/82a336459fda64bde03567c39393c2bd6c06d61ff1ad0821e52dc69b66ca7f06/contract';
import endContract from '../../snapshots/82a336459fda64bde03567c39393c2bd6c06d61ff1ad0821e52dc69b66ca7f06/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, primaryKey, sql } from '@prisma/orm-postgres/migration';

export default class M extends Migration<never, End> {
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createSchema({ schema: 'public' }),
      this.createNativeEnumType({
        schema: 'public',
        typeName: 'DeviceRegistrationType',
        members: ['miioToken', 'hommynShareUrl'],
      }),
      this.createNativeEnumType({
        schema: 'public',
        typeName: 'HomeDeviceKind',
        members: ['humidifier', 'airMonitor', 'breezer'],
      }),
      this.createTable({
        schema: 'public',
        table: 'devices',
        columns: [
          col('createdAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('displayName', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'uuid', {
            notNull: true,
            default: fn(sql`uuidv7()`),
            codecRef: { codecId: 'pg/uuid@1' },
          }),
          col('lastSeenAt', 'timestamptz(3)', {
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'homeDeviceTypes',
        columns: [
          col('code', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('displayName', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'uuid', {
            notNull: true,
            default: fn(sql`uuidv7()`),
            codecRef: { codecId: 'pg/uuid@1' },
          }),
          col('kind', '"HomeDeviceKind"', {
            notNull: true,
            codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'HomeDeviceKind' } },
          }),
          col('model', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('registrationType', '"DeviceRegistrationType"', {
            notNull: true,
            codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'DeviceRegistrationType' } },
          }),
          col('vendor', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'homeDevices',
        columns: [
          col('createdAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('displayName', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'uuid', {
            notNull: true,
            default: fn(sql`uuidv7()`),
            codecRef: { codecId: 'pg/uuid@1' },
          }),
          col('registrationData', 'jsonb', { notNull: true, codecRef: { codecId: 'pg/jsonb@1' } }),
          col('roomId', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('typeId', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'homes',
        columns: [
          col('createdAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('displayName', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'uuid', {
            notNull: true,
            default: fn(sql`uuidv7()`),
            codecRef: { codecId: 'pg/uuid@1' },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'interactionActions',
        columns: [
          col('arguments', 'jsonb', { notNull: true, codecRef: { codecId: 'pg/jsonb@1' } }),
          col('error', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'uuid', {
            notNull: true,
            default: fn(sql`uuidv7()`),
            codecRef: { codecId: 'pg/uuid@1' },
          }),
          col('initiator', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('interactionId', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('operation', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('result', 'jsonb', { codecRef: { codecId: 'pg/jsonb@1' } }),
          col('sequence', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('service', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'interactions',
        columns: [
          col('deviceId', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('error', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('finishedAt', 'timestamptz(3)', {
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('id', 'uuid', {
            notNull: true,
            default: fn(sql`uuidv7()`),
            codecRef: { codecId: 'pg/uuid@1' },
          }),
          col('inputAudioKey', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('outputAudioKey', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('responseSource', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('responseText', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('startedAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('status', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('transcript', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('userId', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'rooms',
        columns: [
          col('createdAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('displayName', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('homeId', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('id', 'uuid', {
            notNull: true,
            default: fn(sql`uuidv7()`),
            codecRef: { codecId: 'pg/uuid@1' },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'users',
        columns: [
          col('createdAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('displayName', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'uuid', {
            notNull: true,
            default: fn(sql`uuidv7()`),
            codecRef: { codecId: 'pg/uuid@1' },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createIndex({
        schema: 'public',
        table: 'homeDeviceTypes',
        index: 'homeDeviceTypes_code_key',
        columns: ['code'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'homeDevices',
        index: 'homeDevices_roomId_idx',
        columns: ['roomId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'homeDevices',
        index: 'homeDevices_typeId_idx',
        columns: ['typeId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'interactionActions',
        index: 'interactionActions_interactionId_sequence_key',
        columns: ['interactionId', 'sequence'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'interactions',
        index: 'interactions_deviceId_startedAt_idx',
        columns: ['deviceId', 'startedAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'interactions',
        index: 'interactions_inputAudioKey_key',
        columns: ['inputAudioKey'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'interactions',
        index: 'interactions_userId_startedAt_idx',
        columns: ['userId', 'startedAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'rooms',
        index: 'rooms_homeId_idx',
        columns: ['homeId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'homeDevices',
        foreignKey: {
          name: 'homeDevices_roomId_fkey',
          columns: ['roomId'],
          references: { schema: 'public', table: 'rooms', columns: ['id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'homeDevices',
        foreignKey: {
          name: 'homeDevices_typeId_fkey',
          columns: ['typeId'],
          references: { schema: 'public', table: 'homeDeviceTypes', columns: ['id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'interactionActions',
        foreignKey: {
          name: 'interactionActions_interactionId_fkey',
          columns: ['interactionId'],
          references: { schema: 'public', table: 'interactions', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'interactions',
        foreignKey: {
          name: 'interactions_deviceId_fkey',
          columns: ['deviceId'],
          references: { schema: 'public', table: 'devices', columns: ['id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'interactions',
        foreignKey: {
          name: 'interactions_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'users', columns: ['id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'rooms',
        foreignKey: {
          name: 'rooms_homeId_fkey',
          columns: ['homeId'],
          references: { schema: 'public', table: 'homes', columns: ['id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      // Retain the checks from the adopted Prisma 7 SQL migrations.
this.addCheckConstraint({schema:'public',table:'devices',constraint:'devices_id_check',expression:'uuid_extract_version(id) IS NOT DISTINCT FROM 7'}),
this.addCheckConstraint({schema:'public',table:'users',constraint:'users_id_check',expression:'uuid_extract_version(id) IS NOT DISTINCT FROM 7'}),
this.addCheckConstraint({schema:'public',table:'interactions',constraint:'interactions_id_check',expression:'uuid_extract_version(id) IS NOT DISTINCT FROM 7'}),
this.addCheckConstraint({schema:'public',table:'interactionActions',constraint:'interactionActions_id_check',expression:'uuid_extract_version(id) IS NOT DISTINCT FROM 7'}),
this.addCheckConstraint({schema:'public',table:'homes',constraint:'homes_uuidv7',expression:'uuid_extract_version(id) IS NOT DISTINCT FROM 7'}),
this.addCheckConstraint({schema:'public',table:'rooms',constraint:'rooms_uuidv7',expression:'uuid_extract_version(id) IS NOT DISTINCT FROM 7'}),
this.addCheckConstraint({schema:'public',table:'homeDeviceTypes',constraint:'homeDeviceTypes_uuidv7',expression:'uuid_extract_version(id) IS NOT DISTINCT FROM 7'}),
this.addCheckConstraint({schema:'public',table:'homeDevices',constraint:'homeDevices_uuidv7',expression:'uuid_extract_version(id) IS NOT DISTINCT FROM 7'}),
this.addCheckConstraint({schema:'public',table:'homes',constraint:'homes_name_nonempty',expression:'length(btrim("displayName")) > 0'}),
this.addCheckConstraint({schema:'public',table:'rooms',constraint:'rooms_name_nonempty',expression:'length(btrim("displayName")) > 0'}),
this.addCheckConstraint({schema:'public',table:'homeDevices',constraint:'homeDevices_name_nonempty',expression:'length(btrim("displayName")) > 0'}),
this.addCheckConstraint({schema:'public',table:'homeDevices',constraint:'homeDevices_registration_object',expression:`jsonb_typeof("registrationData") = 'object'`}),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
