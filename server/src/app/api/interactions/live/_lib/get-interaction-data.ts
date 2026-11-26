import { serializeInteraction } from '../../_lib/serialize-interaction';
import { getInteraction } from '../_data/get-interaction';

export async function getInteractionData({ id }: { id: string }) {
  const interaction = await getInteraction(id);
  if (!interaction) return null;
  const data = serializeInteraction(interaction);
  return data;
}
