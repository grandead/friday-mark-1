import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

export function connectDatabase(connectionString = process.env.DATABASE_URL, schema = 'public') {
  if (!connectionString) throw new Error('Configure DATABASE_URL in server/.env');
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }, { schema }) });
}
