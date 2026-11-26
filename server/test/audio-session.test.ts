import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DEVICE_ID as deviceId, USER_ID as userId } from '../src/config/identity';
import { createTestDatabase } from './database';
import { withServiceResources } from './service-resources';

const { RecordingSession } = await import('../src/services/audio');
const TEMP_DIRECTORY = tmpdir();
const PREFIX = join(TEMP_DIRECTORY, 'friday-session-');

test(
  'WAV finalization failures retain the archive key and mark the interaction failed',
  checkFinalizationFailure,
);

async function checkFinalizationFailure(t: test.TestContext) {
  const database = await createTestDatabase();
  const directory = await mkdtemp(PREFIX);
  t.after(() => database.close());
  t.after(() => rm(directory, { recursive: true, force: true }));
  const resources = { db: database.db, recordingsDir: directory };
  for (const complete of [true, false]) {
    const session = new RecordingSession(ignoreEvent, unexpectedTimeout);
    t.after(() => withServiceResources(resources, () => session.abort('Test cleanup')));
    await withServiceResources(resources, () =>
      session.receive({
        type: 'start',
        userId,
        deviceId,
        sampleRate: 20000,
        format: 's16le',
        channels: 1,
      }),
    );
    const pcm = Buffer.alloc(4);
    await withServiceResources(resources, () => session.receive(pcm));
    const row = await database.db.orm.public.Interaction.select('id', 'inputAudioKey').firstOrThrow(
      { status: 'recording' },
    );
    const destinationName = row.inputAudioKey.replace(
      /\.partial$/,
      complete ? '.wav' : '.incomplete.wav',
    );
    const destination = join(directory, destinationName);
    // Force rename to fail after the WAV header has been written and the file closed.
    await mkdir(destination);
    const pending = complete
      ? withServiceResources(resources, () => session.receive({ type: 'end', samples: 2 }))
      : withServiceResources(resources, () => session.abort('Connection closed'));
    await assert.rejects(pending, /EISDIR|EPERM/);
    const failed = await database.db.orm.public.Interaction.select(
      'status',
      'inputAudioKey',
      'finishedAt',
      'error',
    ).firstOrThrow({ id: row.id });
    assert.equal(failed.status, 'failed');
    assert.equal(failed.inputAudioKey, row.inputAudioKey);
    assert.ok(failed.finishedAt);
    assert.match(failed.error!, /EISDIR|EPERM/);
    const archive = join(directory, failed.inputAudioKey);
    const bytes = await readFile(archive);
    assert.equal(bytes.length, 48);
    await withServiceResources(resources, () => session.abort('Already finalized'));
  }
}

function ignoreEvent() {}
function unexpectedTimeout() {
  assert.fail('Recording timers must be cleared after failure');
}
