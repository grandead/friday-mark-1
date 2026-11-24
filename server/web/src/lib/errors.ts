import { AppError, isErrorCode } from '../../../shared/errors.js';
import { userErrors } from '../../../shared/userErrors.ru.js';

export async function requestError(response: Response): Promise<AppError> {
  // Do not expose server/proxy bodies, credentials or native fetch errors to users.
  const body: unknown = await response.json().catch(() => null);
  const code =
    body && typeof body === 'object' && 'code' in body && isErrorCode(body.code)
      ? body.code
      : 'request_failed';
  return new AppError(code);
}
export function userError(error: unknown): string {
  return userErrors[error instanceof AppError ? error.code : 'request_failed'];
}
