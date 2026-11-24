import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AppError,
  diagnosticError,
  type ErrorCode,
  errorMessages,
  errorResponse,
} from '../shared/errors.js';
import { userErrors } from '../shared/userErrors.ru.js';
import { homeToolDefinitions } from '../src/services/smartHome/tools.js';
import { requestError, userError } from '../web/src/lib/errors.js';

const cyrillic = /[А-Яа-яЁё]/;
test('diagnostics and API identifiers are English; LLM descriptions and user messages are Russian', () => {
  for (const tool of homeToolDefinitions) {
    assert.doesNotMatch(tool.function.name, cyrillic);
    assert.match(tool.function.description, cyrillic);
    for (const name of Object.keys(tool.function.parameters.properties ?? {}))
      assert.doesNotMatch(name, cyrillic);
  }
  for (const code of Object.keys(errorMessages) as ErrorCode[]) {
    const error = new AppError(code);
    assert.doesNotMatch(diagnosticError(error), cyrillic);
    assert.doesNotMatch(JSON.stringify(errorResponse(code)), cyrillic);
    assert.match(userError(error), cyrillic);
    assert.equal(userError(error), userErrors[code]);
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
