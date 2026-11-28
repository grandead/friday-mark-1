#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/317cf11f57056fdf9f3663f3b925ae35e7798a5eba3ddd39f54002419a4908fb/contract';
import startContract from '../../snapshots/317cf11f57056fdf9f3663f3b925ae35e7798a5eba3ddd39f54002419a4908fb/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/6d8205aacf102185e2b0995ef01babe9c0c248eceb11e9a0c41ee39977b5ca6e/contract';
import endContract from '../../snapshots/6d8205aacf102185e2b0995ef01babe9c0c248eceb11e9a0c41ee39977b5ca6e/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addNativeEnumValue({
        schema: 'public',
        typeName: 'DeviceRegistrationType',
        value: 'syncleoToken',
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
