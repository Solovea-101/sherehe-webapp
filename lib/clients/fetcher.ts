/**
 * How Sherehe talks to a partner API. Every partner call goes through partnerFetch, which:
 *  - gives up on each attempt after a timeout (2.5 s when a person is waiting, 60 s in the background),
 *  - retries a failed GET that a person is waiting for, at most twice, 200 ms and then 400 ms apart, and only
 *    when trying again can help: a timeout, a failed connection, a 5xx, or a 429 that asks for a short wait
 *    (honouring Retry-After). Never a 4xx, never a write (POST, PUT, DELETE), never the background poller,
 *  - remembers successful reads for 5 minutes when asked to, and keeps the last good answer of a read that
 *    opts in (serveStale) for up to an hour, to serve flagged as saved when every attempt fails,
 *  - never follows redirects (they could carry our API key to another host),
 *  - turns every kind of partner failure into PartnerUnavailableError, which guard() answers with
 *    our own 502 { message }. The partner's own error text is never passed on to our clients.
 */

import { countPartner } from '@/lib/clients/partnerCounters';

/** The partner could not be reached, was too slow, or gave an answer we cannot use. */
export class PartnerUnavailableError extends Error {
  constructor(
    public readonly partner: string,
    message: string,
    /** True when asking again a moment later can help: a timeout, a failed connection or a 5xx. */
    public readonly retryable = false,
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

export const USER_TIMEOUT_MS = 2_500; // one attempt, while a person is waiting for the page
export const BACKGROUND_TIMEOUT_MS = 60_000; // the poller; Render's free tier can take a minute to wake
export const CACHE_TTL_MS = 5 * 60 * 1000;
export const DEFAULT_RETRIES = 2; // so at most 3 attempts: (2 + 1) x 2.5 s + 200 ms + 400 ms = 8.1 s worst case
export const DEFAULT_RETRY_DELAY_MS = 200; // doubles each time: 200 ms, then 400 ms
export const RETRY_AFTER_MAX_WAIT_MS = 5_000; // a person will not wait longer; a longer Retry-After is not retried
export const STALE_MAX_AGE_MS = 60 * 60 * 1000; // a saved copy is served for up to an hour
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
  /**
   * When every attempt fails, answer with the last good copy (up to an hour old) flagged as saved, instead of
   * failing. Only for a read that is safe to show a little out of date, and only together with cacheTtlMs.
   */
  serveStale?: boolean;
}

export interface PartnerResponse {
  status: number;
  /** Parsed JSON, or undefined when the partner sent no body (204). */
  body: unknown;
  /** Present only when this is a saved copy: the time (UTC, ending in Z, no milliseconds) it was fetched. */
  stale?: { asOf: string };
}

// Kept on globalThis, like the store: Next.js can load this module once per route bundle, and a
// separate copy per bundle would mean separate caches (and a clearPartnerCache that clears the wrong one).
type CacheEntry = { expires: number; storedAt: number; response: PartnerResponse };
const CACHE_KEY = Symbol.for('sherehe.partnerCache');
const holder = globalThis as typeof globalThis & { [CACHE_KEY]?: Map<string, CacheEntry> };
const cache: Map<string, CacheEntry> = (holder[CACHE_KEY] ??= new Map());

/** Forgets everything remembered. For tests. */
export function clearPartnerCache(): void {
  cache.clear();
}

/**
 * The system error code behind a failed fetch, as a log suffix: " (ECONNREFUSED)" means nothing is
 * listening at that address, " (ENOTFOUND)" means the host name is wrong. Only a short upper-case code is
 * kept, so nothing else from the error (an address, a path, a header) can reach a log line.
 */
function causeCode(err: unknown): string {
  const cause = typeof err === 'object' && err !== null && 'cause' in err ? (err as { cause: unknown }).cause : undefined;
  const code = typeof cause === 'object' && cause !== null && 'code' in cause ? (cause as { code: unknown }).code : undefined;
  return typeof code === 'string' && /^[A-Z][A-Z0-9_]{2,40}$/.test(code) ? ` (${code})` : '';
}

function timeoutMs(background: boolean): number {
  // UJUZI_TIMEOUT_MS lets tests (and an operator) shorten both timeouts.
  const override = Number(process.env.UJUZI_TIMEOUT_MS);
  if (Number.isFinite(override) && override > 0) return override;
  return background ? BACKGROUND_TIMEOUT_MS : USER_TIMEOUT_MS;
}

/** Retries for this request. Only a GET a person is waiting for is retried: a write could be done twice, and the poller asks again next round. */
function retriesFor(req: PartnerRequest, method: string): number {
  if (method !== 'GET' || req.background) return 0;
  const n = Number(process.env.UJUZI_RETRIES);
  return Number.isInteger(n) && n >= 0 && n <= 5 ? n : DEFAULT_RETRIES;
}

function retryDelayMs(): number {
  const n = Number(process.env.UJUZI_RETRY_DELAY_MS);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_RETRY_DELAY_MS;
}

/** How long to wait before the next attempt, or null when trying again cannot help (or would make a person wait too long). */
function waitBeforeRetry(err: PartnerUnavailableError, attempt: number): number | null {
  if (err instanceof PartnerRateLimitedError) {
    const ms = err.retryAfterSeconds * 1000;
    return ms <= RETRY_AFTER_MAX_WAIT_MS ? ms : null; // no Retry-After at all reads as a minute, so not retried
  }
  return err.retryable ? retryDelayMs() * 2 ** attempt : null; // 200 ms, then 400 ms
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const isoSeconds = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

/**
 * One attempt, no retries. Resolves for 2xx, 400, 404 and 409; throws PartnerUnavailableError for anything
 * else, marked retryable when asking again a moment later can help (a timeout, a failed connection, a 5xx).
 */
async function attemptOnce(req: PartnerRequest, method: string, limitMs: number): Promise<PartnerResponse> {
  const unavailable = (why: string, retryable = false) => new PartnerUnavailableError(req.partner, `${req.partner} ${why}`, retryable);
  let res: Response;
  try {
    res = await fetch(req.url, {
      method,
      headers: { Accept: 'application/json', ...(req.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...req.headers },
      body: req.body === undefined ? undefined : JSON.stringify(req.body),
      redirect: 'manual',
      signal: AbortSignal.timeout(limitMs),
    });
  } catch (err) {
    // By name, not instanceof: the abort error comes from the runtime, and under Jest that is a
    // different realm, so instanceof Error would be false even for a genuine timeout.
    const name = typeof err === 'object' && err !== null && 'name' in err ? String((err as { name: unknown }).name) : '';
    // The reason goes in the message, which only the log sees: our own clients get the fixed 502 text.
    throw unavailable(name === 'TimeoutError' || name === 'AbortError' ? `did not answer in time (gave up after ${limitMs} ms)` : `could not be reached${causeCode(err)}`, true);
  }

  if (res.status >= 300 && res.status < 400) throw unavailable(`answered with a redirect (${res.status}); check its URL setting`);
  if (res.status === 401 || res.status === 403) throw unavailable(`refused our API key (${res.status})`); // the same every time: not retried
  if (res.status === 429) {
    // Retry-After is whole seconds. Anything missing or silly becomes a minute; never more than 5 minutes.
    const asked = Number(res.headers.get('retry-after'));
    const seconds = Number.isFinite(asked) && asked >= 1 ? Math.min(Math.ceil(asked), 300) : 60;
    throw new PartnerRateLimitedError(req.partner, seconds);
  }
  if (res.status >= 500) throw unavailable(`failed with status ${res.status}`, true);

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
    return { status: res.status, body };
  }
  throw unavailable(`answered with an unexpected status ${res.status}`);
}

/**
 * Sends one request, with the timeout, the retries and the saved copy described at the top of this file.
 * Resolves for 2xx, 400, 404 and 409; throws PartnerUnavailableError for anything else.
 */
export async function partnerFetch(req: PartnerRequest): Promise<PartnerResponse> {
  const method = req.method ?? 'GET';
  const cacheKey = `${method} ${req.url}`;
  const ttl = method === 'GET' ? (req.cacheTtlMs ?? 0) : 0;

  const saved = ttl > 0 ? cache.get(cacheKey) : undefined;
  if (saved && saved.expires > Date.now()) return structuredClone(saved.response);

  const retries = retriesFor(req, method);
  const limitMs = timeoutMs(req.background ?? false);
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        countPartner(req.partner, 'attempts');
        const response = await attemptOnce(req, method, limitMs);
        if (ttl > 0 && response.status === 200) {
          cache.delete(cacheKey); // re-inserted below, so the oldest entry is the first key
          if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value as string);
          cache.set(cacheKey, { expires: Date.now() + ttl, storedAt: Date.now(), response: structuredClone(response) });
        }
        return response;
      } catch (err) {
        if (!(err instanceof PartnerUnavailableError) || attempt >= retries) throw err;
        const wait = waitBeforeRetry(err, attempt);
        if (wait === null) throw err;
        // The message holds only the partner's name and the reason, never the key or the address.
        console.warn(`${err.message}; attempt ${attempt + 1} of ${retries + 1}, trying again in ${wait} ms`);
        countPartner(req.partner, 'retries');
        await sleep(wait);
      }
    }
  } catch (err) {
    // Every attempt failed. A read that opted in answers with its last good copy, flagged, if it is not too old.
    if (err instanceof PartnerUnavailableError && req.serveStale && saved) {
      if (Date.now() - saved.storedAt <= STALE_MAX_AGE_MS) {
        const asOf = isoSeconds(saved.storedAt);
        console.warn(`${err.message}; answering with the saved copy from ${asOf}`);
        countPartner(req.partner, 'savedCopies');
        return { ...structuredClone(saved.response), stale: { asOf } };
      }
      cache.delete(cacheKey); // too old to be a fair picture of today
    }
    if (err instanceof PartnerUnavailableError) countPartner(req.partner, 'unavailable');
    throw err;
  }
}
