/**
 * SSRF-safe fetching for URL ingestion.
 *
 * Threat model: a user (or a crafted import) asks Nexus to "add this page".
 * The server then makes an outbound request from inside the deployment
 * network, which must never reach loopback, private ranges, link-local /
 * cloud metadata endpoints (169.254.169.254), NAT64/6to4 embeddings, or a
 * host that resolves to one of those.
 *
 * Controls implemented here:
 *  - only http/https, no credentials in the URL;
 *  - every hostname is resolved with dns.lookup and every resolved address is
 *    classified; a single blocked address rejects the request;
 *  - the *same* validated address is used for the connection (a custom
 *    `lookup`), which closes the DNS-rebinding window between the check and
 *    the connect;
 *  - redirects are followed manually (cap 3 by default) and re-validated at
 *    every hop;
 *  - the body is size-capped while streaming, and a total wall-clock timeout
 *    aborts the request.
 *
 * `INGEST_ALLOW_PRIVATE_HOSTS=true` is a documented test/self-host override
 * (smoke and the visual harness need a local article server). It is never
 * enabled by default and logs a warning at use.
 */
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';

import { extractArticle, type ExtractedArticle } from './readability.js';
import { ingestionLimits, type IngestionLimits } from './limits.js';

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeUrlError';
  }
}

export interface FetchOptions {
  maxBytes?: number;
  maxRedirects?: number;
  timeoutMs?: number;
  allowPrivate?: boolean;
  /** Accept header override (transcript endpoints return XML). */
  accept?: string;
  limits?: Partial<IngestionLimits>;
}

export interface FetchedResource {
  status: number;
  contentType: string;
  finalUrl: string;
  body: Buffer;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS_DEFAULT = 3;

function allowPrivateHosts(options: FetchOptions): boolean {
  return (
    options.allowPrivate === true ||
    process.env.INGEST_ALLOW_PRIVATE_HOSTS === 'true'
  );
}

// ---------------------------------------------------------------------------
// IP classification (pure, unit tested)
// ---------------------------------------------------------------------------

/** Parse a dotted IPv4 address into four octets, or null. */
export function parseIpv4(
  address: string,
): [number, number, number, number] | null {
  const parts = address.split('.');
  if (parts.length !== 4) return null;
  const octets = parts.map((part) =>
    /^\d{1,3}$/.test(part) ? Number(part) : -1,
  );
  if (octets.some((octet) => octet < 0 || octet > 255)) return null;
  return octets as [number, number, number, number];
}

/** Expand an IPv6 address into eight 16-bit groups, or null when invalid. */
export function expandIpv6(address: string): number[] | null {
  let input = address.trim().toLowerCase();
  if (input.startsWith('[') && input.endsWith(']')) {
    input = input.slice(1, -1);
  }
  // Drop a zone id (fe80::1%eth0).
  const zone = input.indexOf('%');
  if (zone !== -1) input = input.slice(0, zone);
  if (!input.includes(':')) return null;

  // Trailing embedded IPv4 ("::ffff:192.0.2.1").
  let tail: number[] = [];
  const lastColon = input.lastIndexOf(':');
  const maybeV4 = input.slice(lastColon + 1);
  if (maybeV4.includes('.')) {
    const v4 = parseIpv4(maybeV4);
    if (!v4) return null;
    tail = [(v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]];
    input = `${input.slice(0, lastColon + 1)}0:0`;
  }

  const halves = input.split('::');
  if (halves.length > 2) return null;
  const parseGroups = (value: string): number[] | null => {
    if (value === '') return [];
    const groups: number[] = [];
    for (const group of value.split(':')) {
      if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
      groups.push(Number.parseInt(group, 16));
    }
    return groups;
  };

  let groups: number[];
  if (halves.length === 2) {
    const left = parseGroups(halves[0] ?? '');
    const right = parseGroups(halves[1] ?? '');
    if (!left || !right) return null;
    const total = left.length + right.length;
    if (total > 8) return null;
    groups = [...left, ...Array.from({ length: 8 - total }, () => 0), ...right];
  } else {
    const parsed = parseGroups(input);
    if (!parsed) return null;
    groups = parsed;
  }

  if (tail.length === 2) {
    groups = [...groups.slice(0, 6), ...tail];
  }
  if (groups.length !== 8) return null;
  return groups;
}

/** Two 16-bit groups -> dotted IPv4 octets (for mapped/NAT64/6to4 forms). */
function embeddedIpv4(
  high: number,
  low: number,
): [number, number, number, number] {
  return [high >> 8, high & 0xff, low >> 8, low & 0xff];
}

function blockedIpv4(octets: [number, number, number, number]): boolean {
  const [a, b] = octets;
  if (a === 0) return true; // "this" network
  if (a === 10) return true; // RFC1918
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 192 && b === 0 && octets[2] === 0) return true; // IETF protocol
  if (a === 192 && b === 0 && octets[2] === 2) return true; // TEST-NET-1
  if (a === 192 && b === 88 && octets[2] === 99) return true; // 6to4 relay
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 198 && b === 51 && octets[2] === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && octets[2] === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast + reserved + broadcast
  return false;
}

/**
 * True when connecting to this literal IP address must be refused.
 * Conservative by design: unknown/unparseable input is treated as blocked.
 */
export function isBlockedAddress(address: string): boolean {
  const trimmed = address.trim();
  const version = isIP(trimmed.replace(/^\[|\]$/g, ''));
  if (version === 4) {
    const octets = parseIpv4(trimmed);
    return octets ? blockedIpv4(octets) : true;
  }
  if (version !== 6) return true;
  const groups = expandIpv6(trimmed);
  if (!groups) return true;

  // :: (unspecified) and ::1 (loopback)
  if (groups.every((group) => group === 0)) return true;
  if (groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1) {
    return true;
  }
  const first = groups[0] ?? 0;
  // fc00::/7 unique local
  if ((first & 0xfe00) === 0xfc00) return true;
  // fe80::/10 link-local
  if ((first & 0xffc0) === 0xfe80) return true;
  // ff00::/8 multicast
  if ((first & 0xff00) === 0xff00) return true;
  // 2001:db8::/32 documentation
  if (first === 0x2001 && groups[1] === 0x0db8) return true;
  // ::ffff:0:0/96 IPv4-mapped
  if (
    groups.slice(0, 5).every((group) => group === 0) &&
    groups[5] === 0xffff
  ) {
    return blockedIpv4(embeddedIpv4(groups[6] ?? 0, groups[7] ?? 0));
  }
  // 64:ff9b::/96 NAT64 - the last 32 bits carry the IPv4 target.
  if (
    first === 0x0064 &&
    groups[1] === 0xff9b &&
    groups.slice(2, 6).every((group) => group === 0)
  ) {
    return blockedIpv4(embeddedIpv4(groups[6] ?? 0, groups[7] ?? 0));
  }
  // 2002::/16 6to4 - embedded IPv4 in groups 1 and 2.
  if (first === 0x2002) {
    return blockedIpv4(embeddedIpv4(groups[1] ?? 0, groups[2] ?? 0));
  }
  return false;
}

// ---------------------------------------------------------------------------
// URL validation and DNS resolution
// ---------------------------------------------------------------------------

/** Parse and validate the URL shape (protocol, credentials, port). */
export function parseSafeUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new UnsafeUrlError('Enter a valid http:// or https:// URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UnsafeUrlError('Only http:// and https:// URLs can be ingested');
  }
  if (url.username || url.password) {
    throw new UnsafeUrlError('URLs with embedded credentials are not allowed');
  }
  if (!url.hostname) {
    throw new UnsafeUrlError('The URL has no host');
  }
  return url;
}

function unbracket(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, '');
}

interface ResolvedAddress {
  address: string;
  family: number;
}

/**
 * Resolve a hostname and return its addresses. Throws when any resolved
 * address is private/link-local/metadata, unless the explicit test override
 * is active.
 */
export async function resolvePublicAddresses(
  hostname: string,
  options: FetchOptions = {},
): Promise<ResolvedAddress[]> {
  const host = unbracket(hostname);
  if (allowPrivateHosts(options)) {
    const result = await dns.promises.lookup(host, { all: true });
    return result.map((entry) => ({
      address: entry.address,
      family: entry.family,
    }));
  }
  if (isIP(host)) {
    if (isBlockedAddress(host)) {
      throw new UnsafeUrlError(
        `Refusing to fetch a private or link-local address (${host})`,
      );
    }
    return [{ address: host, family: isIP(host) }];
  }

  let resolved: ResolvedAddress[];
  try {
    resolved = await dns.promises.lookup(host, { all: true, verbatim: true });
  } catch {
    throw new UnsafeUrlError(`Could not resolve "${host}"`);
  }
  if (resolved.length === 0) {
    throw new UnsafeUrlError(`Could not resolve "${host}"`);
  }
  for (const entry of resolved) {
    if (isBlockedAddress(entry.address)) {
      throw new UnsafeUrlError(
        `Refusing to fetch "${host}": it resolves to a private or link-local address`,
      );
    }
  }
  return resolved;
}

/**
 * Build the `lookup` callback that pins the connection to an address
 * validated at connect time (closes the check-then-connect race).
 */
function safeLookup(
  options: FetchOptions,
): (
  hostname: string,
  lookupOptions: dns.LookupOptions,
  callback: (
    error: NodeJS.ErrnoException | null,
    address: string | dns.LookupAddress[],
    family?: number,
  ) => void,
) => void {
  return (hostname, lookupOptions, callback) => {
    dns.lookup(
      hostname,
      { ...lookupOptions, all: true, verbatim: true },
      (error, addresses) => {
        if (error) {
          callback(error, '');
          return;
        }
        const list = Array.isArray(addresses) ? addresses : [];
        const allowed = allowPrivateHosts(options)
          ? list
          : list.filter((entry) => !isBlockedAddress(entry.address));
        if (allowed.length === 0) {
          callback(
            Object.assign(
              new UnsafeUrlError('Refusing to connect to a private address'),
              {
                code: 'EUNSAFEADDRESS',
              },
            ),
            '',
          );
          return;
        }
        if (lookupOptions.all) {
          callback(null, allowed);
          return;
        }
        const chosen = allowed[0];
        callback(null, chosen?.address ?? '', chosen?.family);
      },
    );
  };
}

function requestOnce(
  url: URL,
  options: FetchOptions,
): Promise<{ response: http.IncomingMessage; body: Buffer }> {
  const maxBytes =
    options.maxBytes ?? ingestionLimits(options.limits).maxUrlBytes;
  const timeoutMs =
    options.timeoutMs ?? ingestionLimits(options.limits).urlTimeoutMs;
  const transport = url.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const request = transport.request(
      {
        protocol: url.protocol,
        hostname: unbracket(url.hostname),
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        headers: {
          // Identify the client; never send cookies or auth to an arbitrary host.
          'user-agent':
            'nexus/1.0 (+https://github.com/Pranesh-Selvaraj/Nexus)',
          accept:
            options.accept ??
            'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1',
          'accept-language': 'en',
          'accept-encoding': 'identity',
        },
        lookup: safeLookup(options) as never,
        signal: AbortSignal.timeout(timeoutMs),
      },
      (response) => {
        const lengthHeader = Number(response.headers['content-length'] ?? 0);
        if (Number.isFinite(lengthHeader) && lengthHeader > maxBytes) {
          response.destroy();
          reject(
            new UnsafeUrlError(
              `The page is larger than the ${Math.round(maxBytes / 1024 / 1024)} MB ingestion limit`,
            ),
          );
          return;
        }
        const chunks: Buffer[] = [];
        let total = 0;
        response.on('data', (chunk: Buffer) => {
          total += chunk.byteLength;
          if (total > maxBytes) {
            response.destroy();
            reject(
              new UnsafeUrlError(
                `The page is larger than the ${Math.round(maxBytes / 1024 / 1024)} MB ingestion limit`,
              ),
            );
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          resolve({ response, body: Buffer.concat(chunks) });
        });
        response.on('error', (error) => reject(error));
      },
    );
    request.on('error', (error) => {
      if (error instanceof UnsafeUrlError) {
        reject(error);
        return;
      }
      reject(new UnsafeUrlError(`Could not fetch the page: ${error.message}`));
    });
    request.end();
  });
}

/**
 * Fetch a remote resource with SSRF guards, manual redirects, a byte cap and
 * a wall-clock timeout.
 */
export async function fetchResource(
  rawUrl: string,
  options: FetchOptions = {},
): Promise<FetchedResource> {
  const limits = ingestionLimits(options.limits);
  const maxRedirects =
    options.maxRedirects ?? limits.maxRedirects ?? MAX_REDIRECTS_DEFAULT;
  let current = parseSafeUrl(rawUrl);
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    await resolvePublicAddresses(current.hostname, options);
    const { response, body } = await requestOnce(current, options);
    const status = response.statusCode ?? 0;
    const location = response.headers.location;

    if (REDIRECT_STATUSES.has(status) && location) {
      if (hop === maxRedirects) {
        throw new UnsafeUrlError(
          `The page redirected more than ${maxRedirects} times`,
        );
      }
      // Resolve relative redirects against the current URL, then re-run the
      // full validation (a redirect to 127.0.0.1 must be rejected).
      current = parseSafeUrl(new URL(location, current).toString());
      continue;
    }
    if (status < 200 || status >= 300) {
      throw new UnsafeUrlError(`The page returned HTTP ${status}`);
    }

    return {
      status,
      contentType:
        String(response.headers['content-type'] ?? '')
          .split(';')[0]
          ?.trim()
          .toLowerCase() ?? '',
      finalUrl: current.toString(),
      body,
    };
  }
  throw new UnsafeUrlError('Too many redirects');
}

const ARTICLE_CONTENT_TYPES = new Set([
  'text/html',
  'application/xhtml+xml',
  'application/xml',
  'text/xml',
  'text/plain',
]);

/** Fetch a web page and extract its readable article. */
export async function fetchArticle(
  rawUrl: string,
  options: FetchOptions = {},
): Promise<{ article: ExtractedArticle; finalUrl: string; fetchedAt: string }> {
  const resource = await fetchResource(rawUrl, options);
  if (
    resource.contentType &&
    !ARTICLE_CONTENT_TYPES.has(resource.contentType) &&
    !resource.contentType.startsWith('text/')
  ) {
    throw new UnsafeUrlError(
      `That URL returned ${resource.contentType}, which is not a web page`,
    );
  }
  const html = resource.body.toString('utf8');
  if (!html.trim()) {
    throw new UnsafeUrlError('The page contained no text');
  }
  const article =
    resource.contentType === 'text/plain'
      ? {
          title: new URL(resource.finalUrl).hostname,
          text: html.trim(),
          byline: null,
          siteName: null,
          excerpt: html.trim().slice(0, 280),
          wordCount: html.trim().split(/\s+/).length,
          readingMinutes: Math.max(
            1,
            Math.round(html.trim().split(/\s+/).length / 200),
          ),
        }
      : extractArticle(html);
  if (article.wordCount < 20) {
    throw new UnsafeUrlError(
      'The page had too little readable text (it may require JavaScript login or be a paywall)',
    );
  }
  return {
    article,
    finalUrl: resource.finalUrl,
    fetchedAt: new Date().toISOString(),
  };
}

/** Fetch a small text/XML resource (transcript endpoints). */
export async function fetchTextResource(
  rawUrl: string,
  options: FetchOptions = {},
): Promise<{ body: string; finalUrl: string }> {
  const resource = await fetchResource(rawUrl, {
    ...options,
    accept:
      options.accept ?? 'application/xml,text/xml,text/plain;q=0.9,*/*;q=0.1',
    maxBytes:
      options.maxBytes ??
      Math.min(ingestionLimits(options.limits).maxUrlBytes, 2 * 1024 * 1024),
  });
  return { body: resource.body.toString('utf8'), finalUrl: resource.finalUrl };
}
