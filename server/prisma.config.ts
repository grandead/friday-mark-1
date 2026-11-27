import 'dotenv/config';
import { defineConfig as orm, prisma7Schema } from '@prisma/orm-postgres/config';
import { definePrismaConfig } from 'prisma/config';

const connection = process.env.DATABASE_URL;
if (!connection) throw new Error('Configure DATABASE_URL in server/.env');

export default definePrismaConfig({
  orm: orm({
    contract: prisma7Schema('src/services/database/schema'),
    output: 'src/services/database/generated',
    migrations: { dir: 'src/services/database/migrations' },
    db: { connection: connection },
  }),
});
