import { z } from 'zod';
import { errorResponse } from '../../../../../shared/errors';
import { RegistrationDataError } from '../devices/_lib/device-registration';
export function formErrorResponse(error: unknown) {
  if (error instanceof RegistrationDataError) {
    const code =
      error.registrationType === 'miioToken'
        ? 'invalid_miio_registration'
        : 'invalid_hommyn_registration';
    const body = errorResponse(code);
    return Response.json(body, { status: 400 });
  }
  if (error instanceof z.ZodError || error instanceof SyntaxError) {
    const body = errorResponse('invalid_form');
    return Response.json(body, { status: 400 });
  }
  if (error && typeof error === 'object' && 'code' in error && error.code === 'RUNTIME.NO_ROWS') {
    const body = errorResponse('entity_not_found');
    return Response.json(body, { status: 404 });
  }
  const body = errorResponse('internal_error');
  return Response.json(body, { status: 500 });
}
