import 'dotenv/config';

export const serverPort = Number(process.env.PORT ?? 33000);
if (!Number.isInteger(serverPort) || serverPort < 1 || serverPort > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535');
}
