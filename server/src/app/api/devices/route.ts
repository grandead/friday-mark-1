import { errorResponse } from '../../../../shared/errors';
import { listDevices } from './_data/list-devices';

export async function GET() {
  try {
    const devices = await listDevices();
    return Response.json(devices);
  } catch {
    const error = errorResponse('internal_error');
    return Response.json(error, { status: 500 });
  }
}
