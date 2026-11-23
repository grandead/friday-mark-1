import test from 'node:test';
import assert from 'node:assert/strict';
import { createHybridTranscriber } from '../src/services/stt/hybrid.js';

test('hybrid preserves exact device commands without calling the general recognizer', async () => {
  for (const command of ['Включи увлажнитель', 'Пятница, выключи увлажнитель воздуха.']) {
    const transcribe = createHybridTranscriber(async () => command, async () => { assert.fail('Exact command must keep the established recognizer'); });
    assert.equal(await transcribe('recording.wav'), command);
  }
});

test('hybrid uses Whisper for open speech, empty Vosk results and non-exact commands', async () => {
  for (const candidate of ['', 'в чем консилиум отличается от хайлайтер', 'включи влажный', 'не включи увлажнитель', 'он сказал выключи увлажнитель']) {
    const transcribe = createHybridTranscriber(async () => candidate, async path => {
      assert.equal(path, 'recording.wav');
      return 'Текст Whisper';
    });
    assert.equal(await transcribe('recording.wav'), 'Текст Whisper');
  }
});

test('hybrid propagates recognition failures instead of hiding them', async () => {
  const failedVosk = createHybridTranscriber(async () => { throw new Error('Vosk failed'); }, async () => { assert.fail(); });
  await assert.rejects(failedVosk('recording.wav'), /Vosk failed/);
  const failedWhisper = createHybridTranscriber(async () => 'Обычный вопрос', async () => { throw new Error('Whisper failed'); });
  await assert.rejects(failedWhisper('recording.wav'), /Whisper failed/);
});
