import { Browser, type Service } from 'bonjour-service';
import multicastDns from 'multicast-dns';
import { DeviceCommandError } from '../../utils';

export type Endpoint = { port: number; publicKey: string };
export type DeviceType = { vendor: string; deviceType: number };

export async function discover(
  ip: string,
  type: DeviceType,
  signal: AbortSignal,
): Promise<Endpoint> {
  signal.throwIfAborted();
  const found = Promise.withResolvers<Endpoint>();
  const fail = () => found.reject(new DeviceCommandError('device_unreachable'));
  const mdns = multicastDns();
  mdns.on('error', fail);
  const browser = new Browser(mdns, { type: 'syncleo', protocol: 'udp' });
  const inspect = (service: Service) => inspectService(service, ip, type, found);
  const timeout = setTimeout(fail, 7000);
  const retry = setInterval(() => browser.update(), 1500);
  browser.on('up', inspect);
  browser.on('txt-update', inspect);
  browser.on('srv-update', inspect);
  signal.addEventListener('abort', fail, { once: true });
  try {
    return await found.promise;
  } finally {
    clearTimeout(timeout);
    clearInterval(retry);
    signal.removeEventListener('abort', fail);
    browser.stop();
    mdns.destroy();
  }
}

function inspectService(
  service: Service,
  ip: string,
  type: DeviceType,
  found: PromiseWithResolvers<Endpoint>,
) {
  const addresses = service.addresses?.length ? service.addresses : [service.referer?.address];
  if (!addresses.includes(ip) || !service.txt?.vendor) return;
  const txt = service.txt;
  if (
    String(txt.vendor).toLowerCase() !== type.vendor ||
    Number(txt.devtype) !== type.deviceType ||
    Number(txt.protocol) !== 2 ||
    Number(txt.curve) !== 29 ||
    !/^[a-f0-9]{64}$/i.test(txt.public)
  ) {
    const error = new DeviceCommandError('unsupported');
    found.reject(error);
    return;
  }
  found.resolve({ port: service.port, publicKey: txt.public });
}
