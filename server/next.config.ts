import type { NextConfig } from 'next';

const config: NextConfig = {
  serverExternalPackages: ['@prisma/orm-postgres', 'pg', 'sherpa-onnx-node'],
};
export default config;
