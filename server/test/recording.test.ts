import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { Recording } from '../src/services/audio/wav';

const TEMP_DIRECTORY = tmpdir();
const PREFIX = join(TEMP_DIRECTORY, 'friday-recording-');
let directory = '';
let recording: Recording;

beforeEach(prepare);
afterEach(cleanUp);
test('STT receives independent bytes identical to the archived WAV', copiesFrames);
test('recordings enforce alignment and the 120 second limit', limitsRecording);

async function prepare() {
  directory = await mkdtemp(PREFIX);
  const base = join(directory, 'input');
  recording = new Recording(base, 20000);
}

async function cleanUp() {
  await rm(directory, { recursive: true, force: true });
}

async function copiesFrames() {
  const pcm = Buffer.from([1, 0, 2, 0]);
  recording.append(pcm);
  pcm.fill(0);
  const { wav, path } = recording.finish(true);
  const stored = await readFile(path);
  assert.deepEqual(wav, stored);
  assert.equal(wav.length, 48);
  const firstSample = wav.readInt16LE(44);
  const secondSample = wav.readInt16LE(46);
  assert.equal(firstSample, 1);
  assert.equal(secondSample, 2);
  assert.throws(() => recording.finish(true), /already closed/);
  assert.throws(() => recording.append(pcm), /already closed/);
  await rm(path);
  // The recognizer can still use this buffer after the storage file is removed.
  const dataLength = wav.readUInt32LE(40);
  assert.equal(dataLength, 4);
}

function limitsRecording() {
  const unaligned = Buffer.alloc(3);
  assert.throws(() => recording.append(unaligned), /aligned/);
  const maxPcm = Buffer.alloc(20000 * 2 * 120);
  recording.append(maxPcm);
  const extra = Buffer.alloc(2);
  assert.throws(() => recording.append(extra), /Maximum recording/);
  assert.equal(recording.bytes, maxPcm.length);
  recording.finish(false);
}
