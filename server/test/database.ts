import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { connectDatabase } from '../src/services/database/client';

export async function createTestDatabase() {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const url = new URL(process.env.DATABASE_URL!);
  const name = `friday_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Client({ connectionString: url.toString() });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${name}"`);
  url.pathname = `/${name}`;
  const db = connectDatabase(url.toString());
  async function close() {
    await db.close();
    try {
      await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    } finally {
      await admin.end();
    }
  }
  try {
    const cli = fileURLToPath(new URL('../node_modules/.bin/prisma', import.meta.url));
    execFileSync(process.execPath, [cli, 'db', 'migrate'], {
      cwd: root,
      env: { ...process.env, DATABASE_URL: url.toString() },
      stdio: 'pipe',
    });
    execFileSync(process.execPath, ['--import', 'tsx', 'scripts/seed-database.ts'], {
      cwd: root,
      env: { ...process.env, DATABASE_URL: url.toString() },
      stdio: 'pipe',
    });
    return { db, close };
  } catch (error) {
    await close();
    throw error;
  }
}
