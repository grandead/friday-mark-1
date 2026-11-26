import { AsyncLocalStorage } from 'node:async_hooks';
import { join } from 'node:path';
import { mock } from 'node:test';
import * as paths from '../src/config/paths';
import type { Database } from '../src/services/database';
import type { GenerateResponse } from '../src/services/llm';
import { DeviceCommandError, type DeviceDriver } from '../src/services/llm-tools/smart-home/driver';

const DATABASE_MODULE = new URL('../src/services/database/index.ts', import.meta.url);
const LLM_MODULE = new URL('../src/services/llm/index.ts', import.meta.url);
const DRIVER_MODULE = new URL('../src/services/llm-tools/smart-home/driver.ts', import.meta.url);
const STT_MODULE = new URL('../src/services/stt/index.ts', import.meta.url);
const TTS_MODULE = new URL('../src/services/tts/index.ts', import.meta.url);
const ASSISTANT_MODULE = new URL('../src/services/assistant/index.ts', import.meta.url);
const PATHS_MODULE = new URL('../src/config/paths.ts', import.meta.url);

export type ServiceResources = {
  db: Database;
  recordingsDir?: string;
  transcribe?: (wav: Uint8Array) => Promise<string>;
  generateReply?: (id: string, transcript: string) => Promise<string>;
  synthesizeSpeech?: (text: string, output: string) => Promise<void>;
  generateResponse?: GenerateResponse;
  driver?: DeviceDriver;
};

const context = new AsyncLocalStorage<Partial<ServiceResources>>();
const ORM = new Proxy({}, { get: getModel });
const DATABASE = new Proxy({}, { get: getDatabaseProperty });

// All dependency substitution lives in tests. Services keep ordinary imports.
mock.module(DATABASE_MODULE, {
  cache: true,
  namedExports: { db: DATABASE, orm: ORM },
});
mock.module(LLM_MODULE, {
  cache: true,
  namedExports: { generateResponse: generate },
});
mock.module(DRIVER_MODULE, {
  cache: true,
  namedExports: { DeviceCommandError, runDeviceCommand: runCommand },
});
mock.module(STT_MODULE, {
  cache: true,
  namedExports: { transcribe },
});
mock.module(TTS_MODULE, {
  cache: true,
  namedExports: { synthesizeSpeech },
});
mock.module(ASSISTANT_MODULE, {
  cache: true,
  namedExports: { generateReply },
});

mock.module(PATHS_MODULE, {
  cache: true,
  namedExports: { ...paths, recordingPath: testRecordingPath },
});

function testRecordingPath(key: string) {
  const directory = resources().recordingsDir;
  if (!directory) throw new Error('Missing recording directory');
  return join(directory, key);
}

export function resources() {
  const current = context.getStore();
  if (!current) throw new Error('Service test resources are missing');
  return current;
}

export function withServiceResources<T>(options: Partial<ServiceResources>, run: () => T) {
  const current = { ...context.getStore(), ...options };
  return context.run(current, run);
}

function getModel(_target: object, key: string | symbol) {
  const db = testDatabase();
  return Reflect.get(db.orm.public, key);
}

function getDatabaseProperty(_target: object, key: string | symbol) {
  const db = testDatabase();
  const value = Reflect.get(db, key);
  return typeof value === 'function' ? value.bind(db) : value;
}

async function generate(...args: Parameters<GenerateResponse>) {
  const stub = context.getStore()?.generateResponse;
  if (stub) return stub(...args);
  const { generateResponse } = await import('../src/services/llm/generate-response');
  return generateResponse(...args);
}

function runCommand(...args: Parameters<DeviceDriver>) {
  const driver = resources().driver;
  if (!driver) throw new Error('Device driver stub is missing');
  return driver(...args);
}

function transcribe(wav: Uint8Array) {
  const transcribe = resources().transcribe;
  if (!transcribe) throw new Error('Transcription stub is missing');
  return transcribe(wav);
}

async function generateReply(id: string) {
  const { generateReply } = resources();
  if (!generateReply) return '';
  const db = testDatabase();
  const row = await db.orm.public.Interaction.select('transcript').firstOrThrow({ id });
  return generateReply(id, row.transcript ?? '');
}

async function synthesizeSpeech(text: string, output: string) {
  const synthesize = resources().synthesizeSpeech;
  if (synthesize) return synthesize(text, output);
}

function testDatabase() {
  const db = resources().db;
  if (!db) throw new Error('Database test resource is missing');
  return db;
}
