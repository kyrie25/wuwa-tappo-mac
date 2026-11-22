import { get } from 'node:https';
import { isIPv4 } from 'node:net';
import { Readable } from 'node:stream';
import { getRegionProfile } from './regions.mjs';

const origin = getRegionProfile('cn').assetsOrigin;
const resolvers = ['https://dns.google/resolve', 'https://cloudflare-dns.com/dns-query'];
const connectionErrors = new Set(['ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH', 'ETIMEDOUT', 'EPIPE']);

export function isCnCdnUrl(value) {
  const url = new URL(value);
  return url.origin === origin && !url.username && !url.password && !url.hash;
}

async function alternateAddresses(hostname, signal, fetcher) {
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(5_000)]);
  const answers = await Promise.allSettled(resolvers.map(async endpoint => {
    const url = new URL(endpoint);
    url.search = new URLSearchParams({ name: hostname, type: 'A' });
    const response = await fetcher(url, {
      headers: { accept: 'application/dns-json' }, redirect: 'error', signal: deadline,
    });
    if (!response.ok) {
      await response.body?.cancel();
      return [];
    }
    const data = await response.json();
    if (data.Status !== 0 || !Array.isArray(data.Answer)) return [];
    return data.Answer.filter(record => record?.type === 1 && isIPv4(record.data)).map(record => record.data);
  }));
  signal.throwIfAborted();
  const addresses = [...new Set(answers.flatMap(answer => answer.status === 'fulfilled' ? answer.value : []))];
  if (!addresses.length) throw new Error('No CN CDN edge addresses returned by DNS over HTTPS');
  return addresses.slice(0, 16);
}

async function connectToEdge(url, addresses, signal, open) {
  // A CDN edge can accept TCP and then stall. Select on HTTPS response headers.
  const edges = addresses.map(address => ({ address, controller: new AbortController() }));
  let winner;
  try {
    return await new Promise((resolve, reject) => {
      let pending = edges.length;
      let settled = false;
      for (const edge of edges) {
        edge.deadline = setTimeout(() => edge.controller.abort(new Error('CN CDN edge timed out before response headers')), 8_000);
        const request = open(url, {
          signal: AbortSignal.any([signal, edge.controller.signal]), agent: false, family: 4,
          servername: url.hostname, rejectUnauthorized: true,
          headers: { 'accept-encoding': 'identity' },
          lookup: (_hostname, _options, callback) => callback(null, edge.address, 4),
        }, incoming => {
          if (settled) {
            incoming.destroy();
            return;
          }
          settled = true;
          winner = edge;
          resolve(incoming);
        });
        request.once('error', error => {
          if (settled) return;
          if (!edge.controller.signal.aborted && !connectionErrors.has(error.code)) {
            settled = true;
            reject(error);
          } else if (--pending === 0) {
            settled = true;
            reject(new Error('No alternate CN CDN edge returned response headers', { cause: error }));
          }
        });
      }
    });
  } finally {
    for (const edge of edges) {
      clearTimeout(edge.deadline);
      if (edge !== winner) edge.controller.abort();
    }
  }
}

export async function fetchCnCdnEdge(value, { signal }, { fetchDns = fetch, open = get } = {}) {
  if (!isCnCdnUrl(value)) throw new Error('An alternate CDN edge requires the official CN HTTPS origin');
  const url = new URL(value);
  const addresses = await alternateAddresses(url.hostname, signal, fetchDns);
  const incoming = await connectToEdge(url, addresses, signal, open);
  const status = incoming.statusCode;
  if (status < 200 || status > 299) {
    incoming.destroy();
    return { ok: false, status };
  }
  const bodyless = status === 204 || status === 205;
  if (bodyless) incoming.resume();
  return new Response(bodyless ? null : Readable.toWeb(incoming), { status });
}
