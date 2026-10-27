import { findIssuedKey, readPartnerKeyConfig } from '@/lib/auth/partnerKeyConfig';

/**
 * Rate limiting (Week 9). A fixed window counted in this server's memory, so it starts again when the
 * server restarts and is not shared between copies of the server; fine for one Render instance, and
 * the place to put Redis if there are ever several.
 *
 * Who is counted:
 *  - a request with an issued partner key is counted against that key, so one runaway partner cannot
 *    use up anybody else's allowance;
 *  - every other request (the website, a missing or unknown key) is counted against the client's
 *    address. An invented key never gets its own allowance, so rotating fake keys does not help.
 *  - sign-up and login have a smaller allowance of their own, because they are where passwords are
 *    guessed.
 *
 * Settings: RATE_LIMIT_MAX (default 100 requests), RATE_LIMIT_WINDOW_MS (default 60000),
 * RATE_LIMIT_LOGIN_MAX (default 10). RATE_LIMIT_MAX=0 switches the limiter off (the tests and
 * `npm run verify` send hundreds of requests a second from one address).
 */
const HITS = Symbol.for('sherehe.rateLimitHits');
const SWEEP_AT = 5_000; // forget expired windows once the table is this big

interface Entry { count: number; resetAt: number }
type Table = Map<string, Entry>;

export interface RateLimitConfig { max: number; loginMax: number; windowMs: number }
export type RateDecision = { limited: false } | { limited: true; retryAfter: number; limit: number };

const whole = (value: string | undefined, fallback: number): number => {
  const n = Number(value);
  return value !== undefined && value.trim() !== '' && Number.isInteger(n) && n >= 0 ? n : fallback;
};

export function readRateLimitConfig(env: { [name: string]: string | undefined } = process.env): RateLimitConfig {
  const windowMs = whole(env.RATE_LIMIT_WINDOW_MS, 60_000);
  return { max: whole(env.RATE_LIMIT_MAX, 100), loginMax: whole(env.RATE_LIMIT_LOGIN_MAX, 10), windowMs: windowMs === 0 ? 60_000 : windowMs };
}

// The table lives on globalThis: the proxy and the route handlers are separate bundles in one process.
function table(): Table {
  const g = globalThis as typeof globalThis & { [HITS]?: Table };
  return (g[HITS] ??= new Map());
}

/** Counts one request in `bucket` and says whether it is over `max`. */
export function hit(bucket: string, max: number, windowMs: number, now: number = Date.now()): RateDecision {
  if (max === 0) return { limited: false };
  const hits = table();
  if (hits.size >= SWEEP_AT) for (const [id, e] of hits) if (now >= e.resetAt) hits.delete(id);
  let entry = hits.get(bucket);
  if (!entry || now >= entry.resetAt) {
    entry = { count: 0, resetAt: now + windowMs };
    hits.set(bucket, entry);
  }
  entry.count += 1;
  if (entry.count <= max) return { limited: false };
  return { limited: true, retryAfter: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)), limit: max };
}

/** For the tests: forget every count. */
export function resetRateLimit(): void {
  table().clear();
}

const LOGIN_PATHS = new Set(['/api/auth/login', '/api/auth/register']);

/**
 * Decides for one API request. `clientIp` comes from server.ts (the socket, or the proxy's header
 * when TRUST_PROXY is set); `key` is the raw X-API-Key header, if any. The raw key is only ever
 * hashed, never stored or logged.
 */
export function checkRequest(
  req: { method: string; pathname: string; key?: string | null; clientIp?: string | null },
  env: { [name: string]: string | undefined } = process.env,
  now: number = Date.now(),
): RateDecision {
  const config = readRateLimitConfig(env);
  if (config.max === 0) return { limited: false };
  const ip = req.clientIp?.trim() || 'unknown';

  if (req.method === 'POST' && LOGIN_PATHS.has(req.pathname)) {
    const decision = hit(`login:${ip}`, config.loginMax, config.windowMs, now);
    if (decision.limited) return decision;
  }

  // One allowance per consumer, however many of its keys are live (a rotation has two).
  const key = req.key?.trim();
  const partner = key && key.length <= 200 ? findIssuedKey(key, readPartnerKeyConfig(env).keys) : null;
  if (partner) return hit(`key:${partner}`, config.max, config.windowMs, now);
  return hit(`ip:${ip}`, config.max, config.windowMs, now);
}
