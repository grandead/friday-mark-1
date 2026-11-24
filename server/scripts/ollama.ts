import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { llmConfig } from '../src/config/llm.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const command = process.argv[2];
if (command !== 'serve' && command !== 'pull')
  throw new Error('Use npm run llm:serve or npm run llm:pull');
const child = spawn(
  process.env.OLLAMA_BIN ?? join(root, '.tools/ollama/ollama'),
  command === 'pull' ? ['pull', llmConfig.model] : ['serve'],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      OLLAMA_HOST: llmConfig.baseUrl,
      OLLAMA_MODELS: process.env.OLLAMA_MODELS ?? join(root, 'models/ollama'),
      OLLAMA_NO_CLOUD: '1',
      OLLAMA_NUM_PARALLEL: '1',
      OLLAMA_MAX_LOADED_MODELS: '1',
    },
  },
);
child.on('error', (error) => {
  console.error(`Ollama: ${error.message}. Run npm run setup:ollama first.`);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
process.once('SIGINT', () => child.kill('SIGINT'));
process.once('SIGTERM', () => child.kill('SIGTERM'));
