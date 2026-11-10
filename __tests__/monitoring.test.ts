import fs from 'node:fs';
import { createServer as createTcpServer } from 'node:net';
import path from 'node:path';
import request from 'supertest';
import { sha256Hex } from '@/lib/auth/hash';
import { resetPartnerCounts } from '@/lib/clients/partnerCounters';
import { clearPartnerCache } from '@/lib/clients/fetcher';
import { ROUTE_PATTERNS, callerOf, recordRequest, requestLogEnabled, resetRequestStats, routeLabel, statsReport } from '@/lib/monitoring';
import { resetRateLimit } from '@/lib/rateLimit';
import { newOrganiser } from './helpers/auth';
import { useTestServer } from './helpers/server';

const app = useTestServer();

const KAZI_KEY = 'shk_kazi-connect-test-key-0123456789';
const LABS_KEY = 'shk_labs-test-key-abcdef0123456789';

interface Line {
  time: string;
  method: string;
  path: string;
  status: number;
  ms: number;
  caller: string;
  partner?: string;
}

let lines: Line[];
let rawLines: string[];

beforeEach(() => {
  resetRequestStats();
  resetPartnerCounts();
  resetRateLimit();
  clearPartnerCache();
  process.env.PARTNER_KEYS = `kazi:${sha256Hex(KAZI_KEY)},labs:${sha256Hex(LABS_KEY)}`;
  delete process.env.ALLOW_OPEN_PARTNER_API; // a key is really needed in this file
  process.env.REQUEST_LOG = 'true';
  lines = [];
  rawLines = [];
  jest.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    const text = String(args[0]);
    try {
      const parsed = JSON.parse(text) as Line;
      if (typeof parsed === 'object' && parsed !== null && 'method' in parsed && 'status' in parsed) {
        lines.push(parsed);
        rawLines.push(text);
      }
    } catch {
      /* not a request line */
    }
  });
});
afterEach(() => {
  process.env.PARTNER_KEYS = '';
  process.env.ALLOW_OPEN_PARTNER_API = 'true';
  process.env.REQUEST_LOG = 'false';
  process.env.RATE_LIMIT_MAX = '0';
  delete process.env.RATE_LIMIT_PARTNER_MAX;
  process.env.UJUZI_API_URL = '';
  jest.restoreAllMocks();
});

// A line is written after the response has gone out, so give the event loop a moment before reading.
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 30));
const lineFor = (pathname: string, status?: number) => lines.find((l) => l.path === pathname && (status === undefined || l.status === status));

describe('the request log: one line for every request', () => {
  it('has the time, method, path, status, response time and a label for who called, and nothing else', async () => {
    const res = await request(app()).get('/api/events?status=upcoming').set('X-API-Key', KAZI_KEY);
    expect(res.status).toBe(200);
    await settle();
    const line = lineFor('/api/events', 200);
    expect(line).toBeDefined();
    expect(Object.keys(line ?? {}).sort()).toEqual(['caller', 'method', 'ms', 'partner', 'path', 'status', 'time']);
    expect(line?.method).toBe('GET');
    expect(typeof line?.ms).toBe('number');
    expect(line?.ms).toBeGreaterThan(0); // a precise clock, not a rounded 0
    expect(Number.isNaN(Date.parse(line?.time ?? ''))).toBe(false);
    expect(line?.caller).toMatch(/^key-[0-9a-f]{6}$/);
    expect(line?.partner).toBe('kazi');
  });

  it('gives the same caller label to the same key every time, and a different one to another key', async () => {
    await request(app()).get('/api/events/evt_2001').set('X-API-Key', KAZI_KEY);
    await request(app()).get('/api/events/evt_2002').set('X-API-Key', KAZI_KEY);
    await request(app()).get('/api/events/evt_2001').set('X-API-Key', LABS_KEY);
    await settle();
    const [a, b, c] = lines.map((l) => l.caller);
    expect(a).toBe(b);
    expect(c).not.toBe(a);
    expect(lines.map((l) => l.partner)).toEqual(['kazi', 'kazi', 'labs']);
  });

  it('logs requests refused with 401 (a wrong key, and none) as "none", because the logger runs first', async () => {
    expect((await request(app()).get('/api/events?status=upcoming').set('X-API-Key', 'wrong')).status).toBe(401);
    expect((await request(app()).get('/api/events?status=upcoming')).status).toBe(401);
    await settle();
    const refused = lines.filter((l) => l.status === 401);
    expect(refused).toHaveLength(2);
    for (const l of refused) {
      expect(l.caller).toBe('none');
      expect(l.partner).toBeUndefined();
    }
  });

  it('logs a request refused by the rate limiter with 429, which is exactly the one you want to see', async () => {
    process.env.RATE_LIMIT_PARTNER_MAX = '2';
    process.env.RATE_LIMIT_MAX = '100';
    const codes: number[] = [];
    for (let i = 0; i < 3; i += 1) codes.push((await request(app()).get('/api/events?status=upcoming').set('X-API-Key', KAZI_KEY)).status);
    expect(codes).toEqual([200, 200, 429]);
    await settle();
    const limited = lines.find((l) => l.status === 429);
    expect(limited).toBeDefined();
    expect(limited?.caller).toMatch(/^key-[0-9a-f]{6}$/);
  });

  it('labels a logged-in organiser "login" and never writes the token', async () => {
    const me = await newOrganiser(app());
    const token = String(me.auth.Authorization).replace(/^Bearer /, '');
    expect((await request(app()).get('/api/me').set(me.auth)).status).toBe(200);
    await settle();
    expect(lineFor('/api/me', 200)?.caller).toBe('login');
    expect(rawLines.join('\n')).not.toContain(token);
  });

  it('never writes a key, a query string, a password or a body', async () => {
    await request(app()).get('/api/events?status=upcoming&county=SECRET-COUNTY-VALUE').set('X-API-Key', KAZI_KEY);
    await request(app()).post('/api/auth/login').send({ email: 'someone@example.com', password: 'Sup3r-Secret-Passw0rd' });
    await request(app()).get('/api/events?status=upcoming').set('X-API-Key', 'a-wrong-key-that-must-not-appear');
    await settle();
    const all = rawLines.join('\n');
    expect(all).not.toContain(KAZI_KEY);
    expect(all).not.toContain(sha256Hex(KAZI_KEY)); // not the hash either, only its first 6 characters
    expect(all).not.toContain('SECRET-COUNTY-VALUE');
    expect(all).not.toContain('county=');
    expect(all).not.toContain('Sup3r-Secret-Passw0rd');
    expect(all).not.toContain('someone@example.com');
    expect(all).not.toContain('a-wrong-key-that-must-not-appear');
    expect(lineFor('/api/auth/login', 401)).toBeDefined(); // the login itself is logged, just not what was in it
  });

  it('cuts an absurdly long path, and does not log or count the website’s own files', async () => {
    await request(app()).get(`/api/${'x'.repeat(400)}`).set('X-API-Key', KAZI_KEY);
    await request(app()).get('/_next/static/nothing-here.js');
    await settle();
    expect(lines.find((l) => l.path.startsWith('/api/xxxx'))?.path.length).toBeLessThanOrEqual(210);
    expect(lines.some((l) => l.path.startsWith('/_next/'))).toBe(false);
    expect(Object.keys(statsReport().routes).some((r) => r.includes('_next'))).toBe(false);
  });

  it('is switched off by REQUEST_LOG=false, but the numbers still count', async () => {
    process.env.REQUEST_LOG = 'false';
    await request(app()).get('/api/events?status=upcoming').set('X-API-Key', KAZI_KEY);
    await settle();
    expect(lines).toHaveLength(0);
    expect(statsReport().total).toBeGreaterThan(0);
    expect(requestLogEnabled({ REQUEST_LOG: 'false', NODE_ENV: 'production' })).toBe(false);
    expect(requestLogEnabled({ NODE_ENV: 'production' })).toBe(true);
    expect(requestLogEnabled({ NODE_ENV: 'test' })).toBe(false);
    expect(requestLogEnabled({ NODE_ENV: 'test', REQUEST_LOG: 'true' })).toBe(true);
  });
});

describe('callerOf and routeLabel', () => {
  it('fingerprints only a key that was issued, and says "none" for a guess', () => {
    expect(callerOf({ 'x-api-key': KAZI_KEY })).toEqual({ caller: expect.stringMatching(/^key-[0-9a-f]{6}$/), partner: 'kazi' });
    expect(callerOf({ 'x-api-key': 'a guess' })).toEqual({ caller: 'none' });
    expect(callerOf({ 'x-api-key': 'k'.repeat(500) })).toEqual({ caller: 'none' });
    expect(callerOf({ authorization: 'Bearer abc' })).toEqual({ caller: 'login' });
    expect(callerOf({})).toEqual({ caller: 'none' });
    expect(JSON.stringify(callerOf({ 'x-api-key': KAZI_KEY }))).not.toContain(KAZI_KEY);
  });

  it('groups every id under one pattern, so the list cannot grow without end', () => {
    expect(routeLabel('GET', '/api/events/evt_2001')).toBe('GET /api/events/:id');
    expect(routeLabel('GET', '/api/events/evt_9999')).toBe('GET /api/events/:id');
    expect(routeLabel('GET', '/api/events/evt_2001/roles')).toBe('GET /api/events/:id/roles');
    expect(routeLabel('PATCH', '/api/offers/ofr_4001')).toBe('PATCH /api/offers/:id');
    expect(routeLabel('GET', '/api/events/')).toBe('GET /api/events'); // a trailing slash is the same route
  });

  it('puts anything that is not a route in one row, whatever it is called', () => {
    expect(routeLabel('GET', '/api/not-a-route')).toBe('(no route)');
    expect(routeLabel('GET', '/api/events/a/b/c/d')).toBe('(no route)');
    expect(routeLabel('GET', '/api/some-random-probe-1234')).toBe('(no route)');
    expect(routeLabel('OPTIONS', '/api/events')).toBe('(preflight)');
    expect(routeLabel('GET', '/events/evt_2001')).toBe('GET (page)'); // the website's own pages
  });

  it('lists every route in app/api, so a new route cannot be missed', () => {
    const root = path.join(process.cwd(), 'app', 'api');
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) walk(path.join(dir, entry.name));
        else if (entry.name === 'route.ts') found.push(`/api/${path.relative(root, dir).split(path.sep).join('/')}`.replace(/\/$/, ''));
      }
    };
    walk(root);
    const patterns = found.filter((p) => !p.includes('[...')).map((p) => p.replace(/\[[^\]]+\]/g, ':id'));
    expect([...patterns].sort()).toEqual([...ROUTE_PATTERNS].sort());
  });
});

describe('the numbers: GET /api/stats', () => {
  const stats = (key: string | null = KAZI_KEY) => {
    const r = request(app()).get('/api/stats');
    return key ? r.set('X-API-Key', key) : r;
  };

  it('needs a partner key, like every other partner endpoint', async () => {
    const none = await stats(null);
    expect(none.status).toBe(401);
    expect(none.body).toEqual({ message: 'Send your partner key as X-API-Key' });
    expect((await stats('wrong')).status).toBe(401);
    expect((await stats()).status).toBe(200);
    expect((await request(app()).post('/api/stats').set('X-API-Key', KAZI_KEY)).status).toBe(405);
  });

  it('reports the totals, the error counts, the error rate, the average time and a row for each route', async () => {
    await request(app()).get('/api/events?status=upcoming').set('X-API-Key', KAZI_KEY);
    await request(app()).get('/api/events/evt_2001').set('X-API-Key', KAZI_KEY);
    await request(app()).get('/api/events/evt_2002').set('X-API-Key', KAZI_KEY);
    await request(app()).get('/api/events/evt_9999').set('X-API-Key', KAZI_KEY); // 404
    await request(app()).get('/api/events?status=upcoming'); // 401
    await settle();
    const res = await stats();
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['avgMs', 'clientErrors', 'errorRatePercent', 'partners', 'routes', 'serverErrors', 'startedAt', 'total', 'uptimeSeconds']);
    expect(res.body.total).toBe(5); // the request for /api/stats is not in its own answer
    expect(res.body.clientErrors).toBe(2);
    expect(res.body.serverErrors).toBe(0);
    expect(res.body.errorRatePercent).toBe(0); // 4xx are the caller's mistakes: only 5xx make the rate
    expect(res.body.avgMs).toBeGreaterThan(0);
    expect(Number.isNaN(Date.parse(res.body.startedAt))).toBe(false);
    expect(res.body.routes['GET /api/events/:id']).toEqual({ count: 3, clientErrors: 1, serverErrors: 0, avgMs: expect.any(Number), maxMs: expect.any(Number) });
    expect(res.body.routes['GET /api/events'].count).toBe(2); // one 200 and one 401
    expect(Object.keys(res.body.routes).some((r) => r.includes('evt_'))).toBe(false); // never one row for each id
    expect((await stats()).body.routes['GET /api/stats'].count).toBe(1); // it shows up in the next one
  });

  it('counts a 502 (Ujuzi is down) as OUR error, and counts the retries and the failure', async () => {
    const me = await newOrganiser(app());
    const probe = createTcpServer();
    await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
    const { port } = probe.address() as { port: number };
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    process.env.UJUZI_API_URL = `http://127.0.0.1:${port}`; // nothing listens there
    process.env.UJUZI_RETRY_DELAY_MS = '5';
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect((await request(app()).get('/api/training-options').set(me.auth)).status).toBe(502);
    await settle();
    const res = await stats();
    expect(res.body.serverErrors).toBe(1);
    expect(res.body.routes['GET /api/training-options'].serverErrors).toBe(1);
    expect(res.body.errorRatePercent).toBeGreaterThan(0);
    expect(res.body.partners.ujuzi).toEqual({ attempts: 3, retries: 2, savedCopies: 0, unavailable: 1 }); // 3 tries, then our own 502
  });

  it('shows Ujuzi at zero before it has been called, not missing', async () => {
    expect((await stats()).body.partners).toEqual({ ujuzi: { attempts: 0, retries: 0, savedCopies: 0, unavailable: 0 } });
  });
});

describe('recordRequest, the arithmetic', () => {
  it('keeps the average, the slowest and the 4xx/5xx counts per route', () => {
    const rec = (status: number, ms: number) => recordRequest({ method: 'GET', url: '/api/events/evt_1?x=1', status, ms, headers: {} });
    rec(200, 4);
    rec(200, 8);
    rec(404, 30);
    rec(500, 10);
    const r = statsReport();
    expect(r.total).toBe(4);
    expect(r.clientErrors).toBe(1);
    expect(r.serverErrors).toBe(1);
    expect(r.errorRatePercent).toBe(25); // 1 of 4 is a 5xx
    expect(r.avgMs).toBe(13); // (4 + 8 + 30 + 10) / 4 = 13
    expect(r.routes['GET /api/events/:id']).toEqual({ count: 4, clientErrors: 1, serverErrors: 1, avgMs: 13, maxMs: 30 });
  });

  it('reports 0, not NaN, before any request', () => {
    const r = statsReport();
    expect(r.total).toBe(0);
    expect(r.errorRatePercent).toBe(0);
    expect(r.avgMs).toBe(0);
  });
});
