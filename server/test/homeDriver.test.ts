import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { type DeviceCommand, runDeviceCommand } from '../src/services/smartHome/driver.js';

test('transport selects the adapter, preserves Python stdin format and redacts process failures', async (t) => {
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
    transport: 'miio',
    model: 'test-model',
    registrationData: { token: 'private token' },
    operation: 'power',
    parameters: { power: false },
  };
  for (const [transport, filename] of [
    ['miio', 'home-miio.py'],
    ['syncleo', 'home-syncleo.py'],
  ] as const) {
    const result = (await runDeviceCommand({ ...request, transport })) as {
      args: string[];
      body: unknown;
    };
    assert.deepEqual(result.args.slice(0, 2), ['run', '--offline']);
    assert.ok(result.args[2].endsWith(`/scripts/${filename}`));
    assert.ok(!JSON.stringify(result.args).includes('private token'));
    assert.deepEqual(result.body, {
      model: request.model,
      registrationData: request.registrationData,
      operation: 'power',
      power: false,
    });
  }
  for (const [operation, code] of [
    ['invalid', 'invalid_device_state'],
    ['offline', 'device_unreachable'],
    ['knownError', 'heater_missing'],
  ]) {
    await assert.rejects(runDeviceCommand({ ...request, operation }), (error: unknown) => {
      assert.equal((error as { code: string }).code, code);
      assert.doesNotMatch(String(error), /private token/);
      return true;
    });
  }
});
