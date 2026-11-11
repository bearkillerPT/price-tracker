// Shop links and the live browser must only reach public sites: the server sits on a home network
// (router, Gotify, Nextcloud), and a browser or fetcher pointed at it would expose those.
import { isIP } from 'node:net';

let allowPrivate = false;
/** Tests and development serve shop pages from localhost. */
export const setAllowPrivateHosts = (allow: boolean): void => {
  allowPrivate = allow;
};

function privateIPv4(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number) as [number, number];
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

/** True for loopback, private, link-local and local-network names. Hostname-based: no DNS lookup. */
export function isPrivateHost(hostname: string): boolean {
  if (allowPrivate) return false;
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.localhost') || /\.(local|lan|home|internal|intranet|localdomain|home\.arpa)$/.test(host)) return true;
  if (!host.includes('.') && !host.includes(':')) return true; // single-label names resolve on the local network
  const version = isIP(host);
  if (version === 4) return privateIPv4(host);
  if (version === 6) return host === '::1' || host === '::' || /^f[cd]/.test(host) || /^fe[89ab]/.test(host) || (host.startsWith('::ffff:') && privateIPv4(host.slice(7)));
  return false;
}
