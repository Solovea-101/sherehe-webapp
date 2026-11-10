import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { findIssuedKey, readPartnerKeyConfig } from '@/lib/auth/partnerKeyConfig';
import { readPartnerCounts, type PartnerCounts } from '@/lib/clients/partnerCounters';

/**
 * Logs and numbers, so the API can be seen from the outside (Week 12).
 *
 * LOGS say what happened: one line of JSON for each finished request, written after the response has gone out so
 * the status and the time are final. It is registered first (server.ts), so a request refused with 401 or 429 is
 * logged too, and those are the ones most worth seeing.
 *
 *   {"time":"2026-11-10T15:12:01.482Z","method":"GET","path":"/api/events","status":200,"ms":5.2,"caller":"key-dc87f9","partner":"kazi"}
 *
 * What is NEVER logged, on purpose: a key or a token (not even part of one), a password, a request or response body,
 * or a query string. The caller is a short fingerprint of the key (the first 6 characters of its SHA-256), so the
 * same key always gets the same label and nobody can get the key back from it. "partner" is the name the key was
 * issued to (kazi), and appears only for a key that is valid. A wrong or missing key is "none"; a logged-in
 * organiser is "login" (never the token).
 *
 * NUMBERS say how much: counts and times for every request, grouped by route pattern (GET /api/events/:id, not one
 * row for each id, or the list would grow forever), shown by GET /api/stats. They live in this server's memory, so
 * they start again at every restart and would be wrong across several copies of the server. That is fine here; a
 * production system sends them to a shared tool.
 *
 * Not counted or logged: the website's own files under /_next/ and the favicon, which would drown the real traffic.
 */

const round = (n: number) => Math.round(n * 10) / 10;

interface RouteStats {
  count: number;
  clientErrors: number; // 4xx: usually the caller's mistake
  serverErrors: number; // 5xx: our fault
  totalMs: number;
  maxMs: number;
}

interface Stats {
  startedAt: string;
  total: number;
  clientErrors: number;
  serverErrors: number;
  totalMs: number;
  routes: { [label: string]: RouteStats };
}

const STATS = Symbol.for('sherehe.requestStats');
const holder = globalThis as typeof globalThis & { [STATS]?: Stats };
const fresh = (): Stats => ({ startedAt: new Date().toISOString(), total: 0, clientErrors: 0, serverErrors: 0, totalMs: 0, routes: {} });
// One set of numbers for the whole process: server.ts counts, and a route handler in another bundle reads.
const stats = (): Stats => (holder[STATS] ??= fresh());

/** For tests. */
export function resetRequestStats(): void {
  holder[STATS] = fresh();
}

// ---- who called -----------------------------------------------------------------------------------

export interface Caller {
  caller: string;
  partner?: string;
}

/** A label for who called, without ever writing the key itself. */
export function callerOf(headers: { [name: string]: string | string[] | undefined }): Caller {
  const raw = headers['x-api-key'];
  const key = (Array.isArray(raw) ? raw[0] : raw)?.trim();
  if (key) {
    // Only a key we issued gets a label; a wrong one is just "none", so a guess leaves no fingerprint behind.
    const partner = key.length <= 200 ? findIssuedKey(key, readPartnerKeyConfig().keys) : null;
    if (partner) return { caller: `key-${createHash('sha256').update(key).digest('hex').slice(0, 6)}`, partner };
    return { caller: 'none' };
  }
  return headers.authorization ? { caller: 'login' } : { caller: 'none' };
}

// ---- which route -----------------------------------------------------------------------------------

/**
 * Every API route, as a pattern. A test checks this list against the app/api folder, so a new route cannot be added
 * without it. A path matching none of these (a 404, a probe) is grouped as "(no route)" instead of getting a row of
 * its own, which anyone could use to fill the memory.
 */
export const ROUTE_PATTERNS = [
  '/api/auth/register', '/api/auth/login', '/api/auth/logout', '/api/me',
  '/api/events', '/api/events/:id', '/api/events/:id/roles', '/api/events/:id/offers',
  '/api/offers', '/api/offers/:id',
  '/api/training-options', '/api/crew-trainings', '/api/crew-trainings/:id', '/api/certificate-checks',
  '/api/stats',
] as const;

const COMPILED = ROUTE_PATTERNS.map((p) => ({ pattern: p, re: new RegExp(`^${p.replace(/:id/g, '[^/]+')}$`) }));

/** "GET /api/events/:id" for any event id, "GET (page)" for the website, "(no route)" for anything else. */
export function routeLabel(method: string, pathname: string): string {
  const path = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  if (method === 'OPTIONS') return '(preflight)';
  if (!path.startsWith('/api/') && path !== '/api') return `${method} (page)`;
  const hit = COMPILED.find((c) => c.re.test(path));
  return hit ? `${method} ${hit.pattern}` : '(no route)';
}

// ---- recording -------------------------------------------------------------------------------------

/** Skip the website's own files: they would bury the requests that matter. */
const skipped = (pathname: string) => pathname.startsWith('/_next/') || pathname === '/favicon.ico';

/**
 * Lines are written unless REQUEST_LOG=false. The tests switch them off (setupEnv.ts) so their output stays
 * readable, and the tests of the log turn them on.
 */
export function requestLogEnabled(env: { [name: string]: string | undefined } = process.env): boolean {
  if (env.REQUEST_LOG === 'true') return true;
  if (env.REQUEST_LOG === 'false') return false;
  return env.NODE_ENV !== 'test';
}

/** Counts a finished request and, when logging is on, writes its line. */
export function recordRequest(entry: { method: string; url: string; status: number; ms: number; headers: IncomingMessage['headers'] }): void {
  const pathname = entry.url.split('?')[0].split('#')[0] || '/'; // never the query string
  if (skipped(pathname)) return;
  const label = routeLabel(entry.method, pathname);
  const s = stats();
  const r = (s.routes[label] ??= { count: 0, clientErrors: 0, serverErrors: 0, totalMs: 0, maxMs: 0 });
  s.total += 1;
  s.totalMs += entry.ms;
  r.count += 1;
  r.totalMs += entry.ms;
  r.maxMs = Math.max(r.maxMs, entry.ms);
  if (entry.status >= 500) {
    s.serverErrors += 1;
    r.serverErrors += 1;
  } else if (entry.status >= 400) {
    s.clientErrors += 1;
    r.clientErrors += 1;
  }
  if (requestLogEnabled()) {
    console.log(JSON.stringify({
      time: new Date().toISOString(),
      method: entry.method,
      path: pathname.length > 200 ? `${pathname.slice(0, 200)}...` : pathname,
      status: entry.status,
      ms: round(entry.ms),
      ...callerOf(entry.headers),
    }));
  }
}

/** Register first. Starts a precise timer and records the request when its response has been sent. */
export function monitor(req: IncomingMessage, res: ServerResponse): void {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    recordRequest({
      method: req.method ?? 'GET',
      url: req.url ?? '/',
      status: res.statusCode,
      ms: Number(process.hrtime.bigint() - start) / 1e6,
      headers: req.headers,
    });
  });
}

// ---- the numbers -----------------------------------------------------------------------------------

export interface StatsReport {
  startedAt: string;
  uptimeSeconds: number;
  total: number;
  clientErrors: number;
  serverErrors: number;
  errorRatePercent: number;
  avgMs: number;
  routes: { [label: string]: { count: number; clientErrors: number; serverErrors: number; avgMs: number; maxMs: number } };
  /** How often calls to each partner needed retries or fell back to a saved copy. */
  partners: { [partner: string]: PartnerCounts };
}

/** The totals so far. The error rate counts 5xx only: a 4xx is usually the caller's mistake, a 5xx is ours. */
export function statsReport(): StatsReport {
  const s = stats();
  const routes: StatsReport['routes'] = {};
  for (const [label, r] of Object.entries(s.routes)) {
    routes[label] = { count: r.count, clientErrors: r.clientErrors, serverErrors: r.serverErrors, avgMs: round(r.totalMs / r.count), maxMs: round(r.maxMs) };
  }
  return {
    startedAt: s.startedAt,
    uptimeSeconds: Math.round(process.uptime()),
    total: s.total,
    clientErrors: s.clientErrors,
    serverErrors: s.serverErrors,
    errorRatePercent: round(s.total ? (s.serverErrors / s.total) * 100 : 0),
    avgMs: round(s.total ? s.totalMs / s.total : 0),
    routes,
    partners: readPartnerCounts(),
  };
}
