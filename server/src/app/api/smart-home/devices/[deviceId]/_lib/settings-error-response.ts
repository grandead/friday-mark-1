import { z } from 'zod';
import { errorResponse } from '../../../../../../../shared/errors';
import { formErrorResponse } from '../../../_lib/form-error-response';

export function settingsErrorResponse(error: unknown) {
  if (error instanceof z.ZodError || error instanceof SyntaxError) {
    const body = errorResponse('invalid_device_settings');
    return Response.json(body, { status: 400 });
  }
  if (error && typeof error === 'object' && 'code' in error && error.code === 'RUNTIME.NO_ROWS') {
    const body = errorResponse('device_not_found');
    return Response.json(body, { status: 404 });
  }
  return formErrorResponse(error);
}
