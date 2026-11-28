#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/6d8205aacf102185e2b0995ef01babe9c0c248eceb11e9a0c41ee39977b5ca6e/contract';
import startContract from '../../snapshots/6d8205aacf102185e2b0995ef01babe9c0c248eceb11e9a0c41ee39977b5ca6e/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/ee48cc56544f4750b9e8e1f63d62a6007484ff3d9fccef71fc0f400e73ab0800/contract';
import endContract from '../../snapshots/ee48cc56544f4750b9e8e1f63d62a6007484ff3d9fccef71fc0f400e73ab0800/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, sql } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createNativeEnumType({
        schema: 'public',
        typeName: 'DeviceRegistrationKind',
        members: ['miioToken', 'syncleoToken'],
      }),
      this.alterColumnType({
        schema: 'public',
        table: 'homeDeviceTypes',
        column: 'registrationType',
        type: '"DeviceRegistrationKind"',
        using: sql`"registrationType"::text::"public"."DeviceRegistrationKind"`,
      }),
      this.dropNativeEnumType({ schema: 'public', typeName: 'DeviceRegistrationType' }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
