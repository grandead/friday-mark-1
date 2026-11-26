import { orm } from '@/services/database';

export async function getAudioKey(id: string, kind: 'input' | 'output') {
  const row = await orm.Interaction.select('inputAudioKey', 'outputAudioKey').first({ id });
  return (kind === 'input' ? row?.inputAudioKey : row?.outputAudioKey) ?? null;
}
