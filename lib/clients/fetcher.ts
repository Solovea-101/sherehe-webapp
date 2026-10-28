/**
 * How Sherehe talks to a partner API. Every partner call goes through partnerFetch, which:
 *  - gives up after a timeout (10 s when a person is waiting, 60 s in the background),
 *  - remembers successful reads for 5 minutes when asked to,
 *  - never follows redirects (they could carry our API key to another host),
 *  - turns every kind of partner failure into PartnerUnavailableError, which guard() answers with
 *    our own 502 { message }. The partner's own error text is never passed on to our clients.
 */

/** The partner could not be reached, was too slow, or gave an answer we cannot use. */
export class PartnerUnavailableError extends Error {
  constructor(
    public readonly partner: string,
    message: string,
  ) {
    super(message);
    this.name = 'PartnerUnavailableError';
  }
}

/**
 * The partner said 429: we are sending too much. It did not carry the request out. Still an
 * "unavailable" for our own clients (they get our 502), but background work can wait the
 * `retryAfterSeconds` the partner asked for and carry on.
 */
export class PartnerRateLimitedError extends PartnerUnavailableError {
  constructor(
    partner: string,
    public readonly retryAfterSeconds: number,
  ) {
    super(partner, `${partner} limited our requests (429); it asked us to wait ${retryAfterSeconds} s`);
    this.name = 'PartnerRateLimitedError';
  }
}

/** The partner understood the request and said no (400, 404 or 409). The caller decides what that means. */
export class PartnerRejectedError extends Error {
  constructor(
    public readonly partner: string,
    public readonly status: number,
  ) {
    super(`${partner} answered ${status}`);
    this.name = 'PartnerRejectedError';
  }
}

export const USER_TIMEOUT_MS = 10_000; // a person is waiting for the page
export const BACKGROUND_TIMEOUT_MS = 60_000; // the poller; Render's free tier can take a minute to wake
export const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_CACHE_ENTRIES = 500;

export interface PartnerRequest {
  partner: string; // for error messages and logs, e.g. "Ujuzi"
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  url: string;
  headers?: { [name: string]: string };
  body?: unknown;
  background?: boolean; // true: use the long timeout
  /** Remember a successful GET for this long. Leave out (or 0) for data that must be fresh. */
  cacheTtlMs?: number;
}

export interface PartnerResponse {
  status: number;
  /** Parsed JSON, or undefined when the partner sent no body (204). */
  body: unknown;
}

// Kept on globalThis, like the store: Next.js can load this module once per route bundle, and a
// separate copy per bundle would mean separate caches (and a clearPartnerCache that clears the wrong one).
type CacheEntry = { expires: number; response: PartnerResponse };
const CACHE_KEY = Symbol.for('sherehe.partnerCache');
const holder = globalThis as typeof globalThis & { [CACHE_KEY]?: Map<string, CacheEntry> };
const cache: Map<string, CacheEntry> = (holder[CACHE_KEY] ??= new Map());

/** Forgets everything remembered. For tests. */
export function clearPartnerCache(): void {
  cache.clear();
}

function timeoutMs(background: boolean): number {
  // UJUZI_TIMEOUT_MS lets tests (and an operator) shorten both timeouts.
  const override = Number(process.env.UJUZI_TIMEOUT_MS);
  if (Number.isFinite(override) && override > 0) return override;
  return background ? BACKGROUND_TIMEOUT_MS : USER_TIMEOUT_MS;
}

/** Sends one request. Resolves for 2xx, 400, 404 and 409; throws PartnerUnavailableError for anything else. */
export async function partnerFetch(req: PartnerRequest): Promise<PartnerResponse> {
  const method = req.method ?? 'GET';
  const cacheKey = `${method} ${req.url}`;
  const ttl = method === 'GET' ? (req.cacheTtlMs ?? 0) : 0;

  if (ttl > 0) {
    const hit = cache.get(cacheKey);
    if (hit && hit.expires > Date.now()) return structuredClone(hit.response);
    cache.delete(cacheKey);
  }

  const unavailable = (why: string) => new PartnerUnavailableError(req.partner, `${req.partner} ${why}`);
  let res: Response;
  try {
    res = await fetch(req.url, {
      method,
      headers: { Accept: 'application/json', ...(req.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...req.headers },
      body: req.body === undefined ? undefined : JSON.stringify(req.body),
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs(req.background ?? false)),
    });
  } catch (err) {
    // By name, not instanceof: the abort error comes from the runtime, and under Jest that is a
    // different realm, so instanceof Error would be false even for a genuine timeout.
    const name = typeof err === 'object' && err !== null && 'name' in err ? String((err as { name: unknown }).name) : '';
    throw unavailable(name === 'TimeoutError' || name === 'AbortError' ? 'did not answer in time' : 'could not be reached');
  }

  if (res.status >= 300 && res.status < 400) throw unavailable(`answered with a redirect (${res.status}); check its URL setting`);
  if (res.status === 401 || res.status === 403) throw unavailable(`refused our API key (${res.status})`);
  if (res.status === 429) {
    // Retry-After is whole seconds. Anything missing or silly becomes a minute; never more than 5.
    const asked = Number(res.headers.get('retry-after'));
    const seconds = Number.isFinite(asked) && asked >= 1 ? Math.min(Math.ceil(asked), 300) : 60;
    throw new PartnerRateLimitedError(req.partner, seconds);
  }
  if (res.status >= 500) throw unavailable(`failed with status ${res.status}`);

  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) throw unavailable('sent an answer that is too large');
  const text = await res.text();
  if (text.length > MAX_RESPONSE_BYTES) throw unavailable('sent an answer that is too large');

  let body: unknown;
  if (text !== '') {
    try {
      body = JSON.parse(text);
    } catch {
      throw unavailable('sent an answer that is not JSON');
    }
  }

  if (res.status === 204 || res.status === 200 || res.status === 201 || [400, 404, 409].includes(res.status)) {
    const response: PartnerResponse = { status: res.status, body };
    if (ttl > 0 && res.status === 200) {
      if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value as string); // drop the oldest
      cache.set(cacheKey, { expires: Date.now() + ttl, response: structuredClone(response) });
    }
    return response;
  }
  throw unavailable(`answered with an unexpected status ${res.status}`);
}
