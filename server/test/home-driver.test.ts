import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { mock } from 'node:test';
import type { DeviceCommand } from '../src/services/smart-home/driver';

const RUNTIME_MODULE = new URL('../src/services/runtime/index.ts', import.meta.url);
let shutdown = new AbortController();
mock.module(RUNTIME_MODULE, { namedExports: { getShutdownSignal: () => shutdown.signal } });
const { runDeviceCommand } = await import('../src/services/smart-home/driver');

test('Syncleo uses its adapter, preserves Python stdin format and redacts process failures', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'friday-driver-'));
  const originalPath = process.env.PATH;
  t.after(async () => {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    await rm(dir, { recursive: true, force: true });
  });
  // Replace only uv in this test process. No Python adapter or appliance is invoked.
  await writeFile(
    join(dir, 'uv'),
    `#!${process.execPath}
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  const body = JSON.parse(input);
  if (body.operation === 'hang') return setTimeout(() => {}, 30000);
  if (body.operation === 'invalid') return process.stdout.write('not JSON');
  if (body.operation === 'offline') { process.stderr.write('private token'); process.exitCode = 1; return; }
  if (body.operation === 'knownError') { process.exitCode = 1; return process.stdout.write(JSON.stringify({ error: 'heater_missing' })); }
  process.stdout.write(JSON.stringify({ args: process.argv.slice(2), body }));
});
`,
    { mode: 0o755 },
  );
  process.env.PATH = dir;
  const request: DeviceCommand = {
    transport: 'syncleo',
    model: 'test-model',
    registrationData: { token: 'private token' },
    operation: 'power',
    parameters: { power: false },
  };
  const result = (await runDeviceCommand(request)) as {
    args: string[];
    body: unknown;
  };
  assert.deepEqual(result.args.slice(0, 2), ['run', '--offline']);
  assert.ok(result.args[2].endsWith('/scripts/home_syncleo.py'));
  assert.ok(!JSON.stringify(result.args).includes('private token'));
  assert.deepEqual(result.body, {
    model: request.model,
    registrationData: request.registrationData,
    operation: 'power',
    power: false,
  });
  shutdown = new AbortController();
  const hanging = { ...request, operation: 'hang' };
  const pending = runDeviceCommand(hanging);
  shutdown.abort();
  await assert.rejects(pending, { code: 'processing_stopped' });
  shutdown = new AbortController();
  for (const [operation, code] of [
    ['invalid', 'internal_error'],
    ['offline', 'internal_error'],
    ['knownError', 'heater_missing'],
  ]) {
    await assert.rejects(runDeviceCommand({ ...request, operation }), (error: unknown) => {
      assert.equal((error as { code: string }).code, code);
      assert.doesNotMatch(String(error), /private token/);
      return true;
    });
  }
  process.env.PATH = join(dir, 'missing');
  const unavailable = runDeviceCommand(request);
  await assert.rejects(unavailable, { code: 'internal_error' });
});
