import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { connectDatabase } from '../src/services/database/client.js';

export async function createTestDatabase() {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const url = new URL(process.env.DATABASE_URL!);
  const schema = `friday_test_${randomUUID().replaceAll('-', '')}`;
  url.searchParams.set('schema', schema);
  const datasourceUrl = url.toString();
  const cli = fileURLToPath(new URL('../node_modules/.bin/prisma', import.meta.url));
  execFileSync(process.execPath, [cli, 'migrate', 'deploy'], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: datasourceUrl },
    stdio: 'pipe',
  });
  const db = connectDatabase(datasourceUrl, schema);
  return {
    db,
    async close() {
      try {
        await db.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
      } finally {
        await db.$disconnect();
      }
    },
  };
}
