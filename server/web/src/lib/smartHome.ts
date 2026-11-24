import { requestError } from './errors';
export type HomeDevice = { id: string; roomId: string; typeId: string; displayName: string };
export type Room = { id: string; homeId: string; displayName: string; devices: HomeDevice[] };
export type Home = { id: string; displayName: string; rooms: Room[] };
export type DeviceType = {
  id: string;
  code: string;
  displayName: string;
  kind: 'humidifier' | 'airMonitor' | 'breezer';
  registrationType: 'miioToken' | 'hommynShareUrl';
};
export type SmartHomeData = { homes: Home[]; deviceTypes: DeviceType[] };

export async function homeRequest<T>(
  url: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(url, {
    signal,
    ...(body === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
  });
  if (!response.ok) throw await requestError(response);
  return response.json();
}
