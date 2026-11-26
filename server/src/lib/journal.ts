import type { listDevices } from '../app/api/devices/_data/list-devices';
import type { serializeInteractionPage } from '../app/api/interactions/_lib/serialize-interaction-page';
import type { listUsers } from '../app/api/users/_data/list-users';
import { requestError } from './errors';

const INTERACTION_STATUS_LABELS: Record<string, string> = {
  complete: 'Завершено',
  failed: 'Ошибка',
  incomplete: 'Прервано',
  recording: 'Запись',
  processing: 'Обработка',
};

export type User = Awaited<ReturnType<typeof listUsers>>[number];
export type Device = Awaited<ReturnType<typeof listDevices>>[number];
export type InteractionPage = Awaited<ReturnType<typeof serializeInteractionPage>>;
export type Interaction = InteractionPage['items'][number];

export async function getJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw await requestError(response);
  return response.json();
}
export const getInteractionStatusText = (value: string) =>
  INTERACTION_STATUS_LABELS[value] ?? value;
export const formatTime = (value: string) =>
  new Date(value).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
export const formatDate = (value: string) =>
  new Date(value).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
