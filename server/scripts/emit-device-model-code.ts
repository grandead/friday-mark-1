import { readFile, writeFile } from 'node:fs/promises';

const schema = await readFile('src/services/database/schema/smart-home.prisma', 'utf8');
const block = /^enum\s+DeviceModelCode\s*\{([^}]*)\}/m.exec(schema);
if (!block) throw new Error('Missing DeviceModelCode in the smart-home schema.');

const members: string[] = [];
for (const line of block[1].split('\n')) {
  const field = line.split('//')[0].trim();
  if (!field) continue;
  const match = /^(\w+)\s+@map\(\s*"([a-z0-9-]+)"\s*\)$/.exec(field);
  if (!match) throw new Error(`Expected a mapped device model code: ${field}`);
  members.push(`  ${match[1]} = '${match[2]}',`);
}
const fields = members.join('\n');
const header = '// Generated from smart-home.prisma by npm run db:emit.';
await writeFile(
  'shared/device-model-code.ts',
  `${header}\nexport enum DeviceModelCode {\n${fields}\n}\n`,
);
