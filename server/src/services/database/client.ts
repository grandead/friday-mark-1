import 'dotenv/config';
import postgres from '@prisma/orm-postgres/runtime';
import { contractFromJson } from '@prisma/orm-postgres/static';
import type { Contract } from './generated/contract';
import contractJson from './generated/contract.json' with { type: 'json' };

const CONTRACT = contractFromJson<Contract>(contractJson);

export const db = connectDatabase();
export const orm = db.orm.public;

export function connectDatabase(url = process.env.DATABASE_URL) {
  if (!url) throw new Error('Configure DATABASE_URL in server/.env');
  return postgres({ contract: CONTRACT, url });
}
export type Database = ReturnType<typeof connectDatabase>;
