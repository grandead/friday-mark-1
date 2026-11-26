import { orm } from '@/services/database';
import { selectActions } from '../../_data/list-interactions';

export function getInteraction(id: string) {
  return orm.Interaction.select(
    'id',
    'deviceId',
    'userId',
    'startedAt',
    'status',
    'transcript',
    'responseText',
    'responseSource',
    'error',
    'inputAudioKey',
    'outputAudioKey',
  )
    .include('device', (r) => r.select('id', 'displayName'))
    .include('user', (r) => r.select('id', 'displayName'))
    .include('actions', selectActions)
    .first({ id });
}
