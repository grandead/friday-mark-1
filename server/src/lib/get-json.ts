import { requestError } from './errors';

export async function getJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw await requestError(response);
  return response.json();
}
