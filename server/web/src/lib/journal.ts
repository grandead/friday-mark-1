import type {
  listDevices,
  listInteractions,
  listUsers,
} from '../../../src/services/journal/journal';
import { requestError } from './errors';

export type User = Awaited<ReturnType<typeof listUsers>>[number];
export type Device = Awaited<ReturnType<typeof listDevices>>[number];
export type JournalPage = Awaited<ReturnType<typeof listInteractions>>;
export type Entry = JournalPage['items'][number];

export async function getJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw await requestError(response);
  return response.json();
}

const statuses: Record<string, string> = {
  complete: 'Завершено',
  failed: 'Ошибка',
  incomplete: 'Прервано',
  recording: 'Запись',
  processing: 'Обработка',
};
export const statusText = (value: string) => statuses[value] ?? value;
export const time = (value: string) =>
  new Date(value).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
export const date = (value: string) =>
  new Date(value).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
