import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AppError,
  diagnosticError,
  ERROR_MESSAGES,
  type ErrorCode,
  errorResponse,
} from '../shared/errors';
import { USER_ERRORS } from '../shared/user-errors.ru';
import { requestError, userError } from '../src/lib/errors';
import { TOOL_DEFINITIONS } from '../src/services/llm-tools';

const cyrillic = /[А-Яа-яЁё]/;
test('diagnostics and API identifiers are English; LLM descriptions and user messages are Russian', () => {
  for (const tool of TOOL_DEFINITIONS) {
    assert.doesNotMatch(tool.function.name, cyrillic);
    assert.match(tool.function.description, cyrillic);
    for (const name of Object.keys(tool.function.parameters.properties ?? {}))
      assert.doesNotMatch(name, cyrillic);
  }
  for (const code of Object.keys(ERROR_MESSAGES) as ErrorCode[]) {
    const error = new AppError(code);
    assert.doesNotMatch(diagnosticError(error), cyrillic);
    assert.doesNotMatch(JSON.stringify(errorResponse(code)), cyrillic);
    assert.match(userError(error), cyrillic);
    assert.equal(userError(error), USER_ERRORS[code]);
  }
});

test('UI translates error codes without displaying diagnostic bodies or native failures', async () => {
  const known = await requestError(
    new Response(
      JSON.stringify({ code: 'invalid_miio_registration', message: 'Secret token: private' }),
      { status: 400 },
    ),
  );
  assert.equal(known.code, 'invalid_miio_registration');
  assert.match(userError(known), /Укажите корректный IPv4/);
  const unknown = await requestError(
    new Response(JSON.stringify({ code: 'unknown', message: 'private' }), { status: 500 }),
  );
  const nonJson = await requestError(
    new Response('<html>private proxy failure</html>', { status: 502 }),
  );
  for (const error of [known, unknown, nonJson, new TypeError('Failed to fetch private')]) {
    assert.match(userError(error), cyrillic);
    assert.doesNotMatch(userError(error), /private|Failed to fetch/);
  }
});
