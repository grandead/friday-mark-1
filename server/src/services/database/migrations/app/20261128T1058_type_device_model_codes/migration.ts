#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/0b9125caa61665477e1e20f931c07837645ce59a5445bb8be4a4ed0dd299e839/contract';
import endContract from '../../snapshots/0b9125caa61665477e1e20f931c07837645ce59a5445bb8be4a4ed0dd299e839/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/ee48cc56544f4750b9e8e1f63d62a6007484ff3d9fccef71fc0f400e73ab0800/contract';
import startContract from '../../snapshots/ee48cc56544f4750b9e8e1f63d62a6007484ff3d9fccef71fc0f400e73ab0800/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, sql } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createNativeEnumType({
        schema: 'public',
        typeName: 'DeviceModelCode',
        members: [
          'ballu-oneair-asp-100',
          'qingping-air-monitor-lite',
          'smartmi-fresh-air',
          'xiaomi-smart-humidifier-2',
        ],
      }),
      this.alterColumnType({
        schema: 'public',
        table: 'homeDeviceTypes',
        column: 'code',
        type: '"DeviceModelCode"',
        using: sql`"code"::"public"."DeviceModelCode"`,
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
