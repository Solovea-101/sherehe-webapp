import request from 'supertest';
import { sha256Hex } from '@/lib/auth/hash';
import { checkRequest, hit, readRateLimitConfig, resetRateLimit } from '@/lib/rateLimit';
import { useTestServer } from './helpers/server';

const app = useTestServer();

const KAZI_KEY = 'shk_kazi-connect-test-key-0123456789';
const OTHER_KEY = 'shk_a-second-system-test-key-abcdef';

beforeEach(() => {
  resetRateLimit();
  process.env.PARTNER_KEYS = `kazi:${sha256Hex(KAZI_KEY)},other:${sha256Hex(OTHER_KEY)}`;
  process.env.RATE_LIMIT_MAX = '3';
  process.env.RATE_LIMIT_LOGIN_MAX = '2';
  delete process.env.RATE_LIMIT_WINDOW_MS;
});
afterEach(() => {
  process.env.PARTNER_KEYS = '';
  process.env.RATE_LIMIT_MAX = '0';
  delete process.env.RATE_LIMIT_LOGIN_MAX;
});

describe('reading the settings', () => {
  it('defaults to 100 requests a minute, 10 sign-ins a minute', () => {
    expect(readRateLimitConfig({})).toEqual({ max: 100, loginMax: 10, windowMs: 60_000 });
  });
  it('takes whole numbers, 0 for off, and ignores nonsense', () => {
    expect(readRateLimitConfig({ RATE_LIMIT_MAX: '0' }).max).toBe(0);
    expect(readRateLimitConfig({ RATE_LIMIT_MAX: '25', RATE_LIMIT_WINDOW_MS: '1000' })).toMatchObject({ max: 25, windowMs: 1000 });
    expect(readRateLimitConfig({ RATE_LIMIT_MAX: 'lots' }).max).toBe(100);
    expect(readRateLimitConfig({ RATE_LIMIT_MAX: '-5' }).max).toBe(100);
    expect(readRateLimitConfig({ RATE_LIMIT_MAX: '2.5' }).max).toBe(100);
    expect(readRateLimitConfig({ RATE_LIMIT_WINDOW_MS: '0' }).windowMs).toBe(60_000);
  });
});

describe('the counter', () => {
  it('lets max requests through, then limits, with the seconds until the window ends', () => {
    const t = 1_000_000;
    expect([1, 2, 3].map(() => hit('a', 3, 60_000, t).limited)).toEqual([false, false, false]);
    expect(hit('a', 3, 60_000, t + 10_000)).toEqual({ limited: true, retryAfter: 50, limit: 3 });
    expect(hit('b', 3, 60_000, t + 10_000).limited).toBe(false); // another bucket is untouched
  });
  it('says so in the log once per window, naming the caller and no key', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const t = 7_000_000;
    for (let i = 0; i < 6; i += 1) hit('key:kazi', 3, 60_000, t);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('Rate limit: key:kazi went over 3 requests in 60 s; answering 429 for 60 s');
    hit('key:kazi', 3, 60_000, t + 60_000); // a new window starts the count again
    warn.mockRestore();
  });
  it('starts a fresh window once the old one is over', () => {
    const t = 5_000_000;
    for (let i = 0; i < 4; i += 1) hit('a', 3, 1000, t);
    expect(hit('a', 3, 1000, t + 500).limited).toBe(true);
    expect(hit('a', 3, 1000, t + 1000).limited).toBe(false);
  });
  it('never asks a caller to wait less than a second', () => {
    const t = 9_000_000;
    for (let i = 0; i < 3; i += 1) hit('a', 2, 1000, t);
    expect(hit('a', 2, 1000, t + 999)).toMatchObject({ limited: true, retryAfter: 1 });
  });
  it('does nothing when max is 0', () => {
    expect(hit('a', 0, 1000).limited).toBe(false);
  });
});

describe('who is counted', () => {
  const env = { PARTNER_KEYS: `kazi:${sha256Hex(KAZI_KEY)},other:${sha256Hex(OTHER_KEY)}`, RATE_LIMIT_MAX: '2', RATE_LIMIT_LOGIN_MAX: '1' };
  const call = (key: string | null, ip: string, method = 'GET', pathname = '/api/events') => checkRequest({ method, pathname, key, clientIp: ip }, env);

  it('counts an issued key on its own, whatever address it comes from', () => {
    call(KAZI_KEY, '10.0.0.1');
    call(KAZI_KEY, '10.0.0.2');
    expect(call(KAZI_KEY, '10.0.0.3').limited).toBe(true);
    expect(call(OTHER_KEY, '10.0.0.1').limited).toBe(false);
  });
  it('counts an unknown key by address, so inventing keys does not buy a new allowance', () => {
    call('invented-1', '10.0.0.9');
    call('invented-2', '10.0.0.9');
    expect(call('invented-3', '10.0.0.9').limited).toBe(true);
    expect(call(null, '10.0.0.10').limited).toBe(false);
  });
  it('gives sign-up and login a smaller allowance of their own', () => {
    expect(call(null, '10.1.1.1', 'POST', '/api/auth/login').limited).toBe(false);
    expect(call(null, '10.1.1.1', 'POST', '/api/auth/login').limited).toBe(true);
    expect(call(null, '10.1.1.1', 'POST', '/api/auth/register').limited).toBe(true); // same small allowance
    expect(call(null, '10.1.1.1', 'GET', '/api/events').limited).toBe(false); // other calls are not affected
  });
});

describe('over HTTP', () => {
  const get = (key?: string) => {
    const r = request(app()).get('/api/events?status=upcoming');
    return key ? r.set('X-API-Key', key) : r;
  };

  it('answers 200 200 200 429 429 with Retry-After and a JSON body', async () => {
    const codes: number[] = [];
    let last = await get(KAZI_KEY);
    codes.push(last.status);
    for (let i = 0; i < 4; i += 1) {
      last = await get(KAZI_KEY);
      codes.push(last.status);
    }
    expect(codes).toEqual([200, 200, 200, 429, 429]);
    expect(last.headers['retry-after']).toMatch(/^\d+$/);
    expect(Number(last.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    expect(last.headers['content-type']).toMatch(/application\/json/);
    expect(last.body).toEqual({ message: 'Too many requests. Wait a little and try again.', retryAfter: Number(last.headers['retry-after']) });
    expect(last.headers['access-control-allow-origin']).toBe('*');
  });

  it('limits one partner without touching another', async () => {
    for (let i = 0; i < 4; i += 1) await get(KAZI_KEY);
    expect((await get(KAZI_KEY)).status).toBe(429);
    expect((await get(OTHER_KEY)).status).toBe(200);
  });

  it('counts a wrong key too, so guessing keys is limited by address', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 5; i += 1) codes.push((await get(`wrong-${i}`)).status);
    expect(codes).toEqual([401, 401, 401, 429, 429]);
  });

  it('does not count a CORS preflight', async () => {
    for (let i = 0; i < 6; i += 1) expect((await request(app()).options('/api/events')).status).toBe(204);
    expect((await get(KAZI_KEY)).status).toBe(200);
  });

  it('limits login attempts by address', async () => {
    const attempt = () => request(app()).post('/api/auth/login').send({ email: 'nobody@example.com', password: 'wrong-password' });
    expect([(await attempt()).status, (await attempt()).status]).toEqual([401, 401]);
    const limited = await attempt();
    expect(limited.status).toBe(429);
    expect(limited.headers['retry-after']).toBeDefined();
  });

  it('cannot be dodged by sending our own client-address header', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 5; i += 1) codes.push((await get('wrong').set('x-sherehe-client-ip', `9.9.9.${i}`)).status);
    expect(codes).toEqual([401, 401, 401, 429, 429]);
  });

  it('is off when RATE_LIMIT_MAX is 0', async () => {
    process.env.RATE_LIMIT_MAX = '0';
    for (let i = 0; i < 8; i += 1) expect((await get(KAZI_KEY)).status).toBe(200);
  });
});
