import { errorResponse } from '../../../../shared/errors';
import { listUsers } from './_data/list-users';

export async function GET() {
  try {
    const users = await listUsers();
    return Response.json(users);
  } catch {
    const error = errorResponse('internal_error');
    return Response.json(error, { status: 500 });
  }
}
