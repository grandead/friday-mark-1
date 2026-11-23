import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { createHomeDevice } from '../services/smartHome/devices.js';
import { RegistrationDataError } from '../services/validation/homeDevice.js';

const name = z.string().trim().min(1).max(120);
const homeInput = z.strictObject({ displayName: name });
const roomInput = z.strictObject({ homeId: z.uuidv7(), displayName: name });

export async function smartHomeRoutes(app: FastifyInstance, { db }: { db: PrismaClient }) {
  app.setErrorHandler((error: Error & { code?: string; statusCode?: number }, _request, reply) => {
    if (error instanceof RegistrationDataError) return reply.code(400).send({ message: error.registrationType === 'miioToken'
      ? 'Укажите корректный IPv4-адрес и токен из 32 шестнадцатеричных символов.'
      : 'Укажите ссылку «Поделиться» из HOMMYN, содержащую токен доступа.' });
    if (error instanceof z.ZodError || error.statusCode === 400) return reply.code(400).send({ message: 'Проверьте поля формы. Название должно содержать от 1 до 120 символов.' });
    if (error.code === 'P2025' || error.code === 'P2003') return reply.code(404).send({ message: 'Дом, комната или модель больше недоступны. Обновите страницу.' });
    return reply.code(500).send({ message: 'Не удалось выполнить запрос. Попробуйте ещё раз.' });
  });
  app.get('/api/smart-home', async () => {
    const [homes, deviceTypes] = await Promise.all([
      db.home.findMany({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: {
        id: true, displayName: true, rooms: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: {
          id: true, homeId: true, displayName: true, devices: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: {
            id: true, roomId: true, typeId: true, displayName: true,
          } },
        } },
      } }),
      db.homeDeviceType.findMany({ orderBy: { displayName: 'asc' }, select: {
        id: true, code: true, displayName: true, kind: true, registrationType: true,
      } }),
    ]);
    return { homes, deviceTypes };
  });
  app.post('/api/smart-home/homes', async (request, reply) => {
    const data = homeInput.parse(request.body);
    return reply.code(201).send(await db.home.create({ data, select: { id: true, displayName: true } }));
  });
  app.post('/api/smart-home/rooms', async (request, reply) => {
    const data = roomInput.parse(request.body);
    return reply.code(201).send(await db.room.create({ data, select: { id: true, homeId: true, displayName: true } }));
  });
  app.post('/api/smart-home/devices', async (request, reply) => reply.code(201).send(await createHomeDevice(db, request.body)));
}
