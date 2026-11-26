import { errorResponse } from '../../../../shared/errors';
import { getSmartHome } from './_data/get-smart-home';

export async function GET() {
  try {
    const smartHome = await getSmartHome();
    return Response.json(smartHome);
  } catch {
    const error = errorResponse('internal_error');
    return Response.json(error, { status: 500 });
  }
}
