import { execFile } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import { promisify } from 'node:util';
import request from 'supertest';
import { formatReport, runRingCheck, type RingConfig, type Step } from '../scripts/ringCheck';
import { sha256Hex } from '@/lib/auth/hash';
import { useTestServer } from './helpers/server';
import { useUjuziStub } from './helpers/ujuziWorld';

const app = useTestServer();
const ujuzi = useUjuziStub();

const UJUZI_KEY = 'ujuzi-issued-key-for-sherehe';
const KAZI_KEY = 'shk_ring-check-test-key';
const EMAIL = 'ring.check@example.com';
const PASSWORD = 'ring check password';

let config: RingConfig;

beforeAll(async () => {
  await request(app()).post('/api/auth/register').send({ email: EMAIL, name: 'Ring Check', password: PASSWORD });
});

beforeEach(() => {
  process.env.PARTNER_KEYS = sha256Hex(KAZI_KEY); // this deployment has issued Kazi a key
  process.env.UJUZI_API_KEY = UJUZI_KEY;
  ujuzi().requireKey = UJUZI_KEY;
  config = {
    ujuziUrl: ujuzi().url, ujuziKey: UJUZI_KEY,
    shereheUrl: `http://127.0.0.1:${(app().address() as AddressInfo).port}`, sherehePartnerKey: KAZI_KEY,
    checkEmail: EMAIL, checkPassword: PASSWORD, timeoutMs: 3_000, retryDelayMs: 10,
  };
});
afterEach(() => {
  process.env.PARTNER_KEYS = '';
  jest.restoreAllMocks();
});

const failures = (steps: Step[]) => steps.filter((s) => !s.ok);
const titles = (steps: Step[]) => steps.map((s) => s.title);
const step = (steps: Step[], part: string) => steps.find((s) => s.title.includes(part));

describe('when both systems are as they should be', () => {
  it('passes every step, reading Ujuzi live and Sherehe the way Kazi does', async () => {
    const steps = await runRingCheck(config);
    expect(failures(steps)).toEqual([]);
    expect(titles(steps)).toEqual([
      'Ujuzi: one live read (GET /api/courses)',
      "Ujuzi: the answer fits Ujuzi's contract (partner-tests/ujuzi_openapi.yaml)",
      'Ujuzi: the first course is assignable to types/ujuzi.d.ts (Course)',
      'Sherehe: GET /api/events?status=upcoming',
      expect.stringMatching(/^Sherehe: GET \/api\/events\/evt_\d+$/),
      expect.stringMatching(/^Sherehe: GET \/api\/events\/evt_\d+\/roles$/),
      'Sherehe: a call without a key is refused (R4)',
      'Sherehe -> Ujuzi: GET /api/training-options through the deployment',
    ]);
    expect(step(steps, 'one live read')?.detail).toContain('4 courses, with our key');
    expect(step(steps, 'without a key is refused')?.detail).toContain('401 { message }');
  });

  it('only reads: nothing is created, changed or cancelled anywhere', async () => {
    await runRingCheck(config);
    const writes = ujuzi().calls.filter((c) => c.method !== 'GET');
    expect(writes).toEqual([]);
    expect(ujuzi().bookings.size).toBe(0);
  });

  it('sends our key to Ujuzi and Kazi’s key to Sherehe, and never prints either', async () => {
    const steps = await runRingCheck(config);
    expect(ujuzi().calls[0].apiKey).toBe(UJUZI_KEY);
    const report = formatReport(steps, config);
    for (const secret of [UJUZI_KEY, KAZI_KEY, PASSWORD]) expect(report).not.toContain(secret);
    expect(report).toContain('All 8 steps passed.');
  });

  it('skips the logged-in step politely when no check account is given', async () => {
    const steps = await runRingCheck({ ...config, checkEmail: undefined, checkPassword: undefined });
    expect(failures(steps)).toEqual([]);
    expect(step(steps, 'through the deployment')?.detail).toContain('skipped');
  });
});

describe('when Ujuzi is not ready (and the report says which held item that is)', () => {
  it('fails, naming the held item, when there is no Ujuzi URL at all', async () => {
    const steps = await runRingCheck({ ...config, ujuziUrl: undefined });
    expect(step(steps, 'Ujuzi: one live read')).toMatchObject({ ok: false, detail: 'UJUZI_API_URL is not set', held: expect.stringContaining('H2') });
    expect(failures(steps).every((s) => s.title.startsWith('Ujuzi') || s.title.includes('-> Ujuzi'))).toBe(true);
  });

  it('fails with H2 or H4 when Ujuzi cannot be reached', async () => {
    ujuzi().mode = 'down';
    const steps = await runRingCheck(config);
    expect(step(steps, 'one live read')).toMatchObject({ ok: false, held: expect.stringMatching(/H2.*H4/) });
    expect(step(steps, 'one live read')?.detail).toBe('could not connect');
    expect(step(steps, 'fits Ujuzi')).toBeUndefined(); // nothing to compare, so no misleading second failure
  });

  it('fails with H3 when Ujuzi refuses our key, and says whether we sent one', async () => {
    const wrong = await runRingCheck({ ...config, ujuziKey: 'not-the-key' });
    expect(step(wrong, 'one live read')).toMatchObject({ ok: false, held: expect.stringContaining('H3') });
    expect(step(wrong, 'one live read')?.detail).toContain('did not accept our key');
    const none = await runRingCheck({ ...config, ujuziKey: undefined });
    expect(step(none, 'one live read')?.detail).toContain('wants a key and none is set');
  });

  it('fails when Ujuzi answers with a server error or a page that is not JSON', async () => {
    ujuzi().mode = 'error500';
    expect(step(await runRingCheck(config), 'one live read')).toMatchObject({ ok: false, detail: 'Ujuzi answered 500' });
    ujuzi().mode = 'garbage';
    expect(step(await runRingCheck(config), 'one live read')).toMatchObject({ ok: false });
  });

  it('times out instead of waiting forever for a Ujuzi that does not answer', async () => {
    ujuzi().mode = 'slow';
    ujuzi().slowMs = 5_000;
    const started = Date.now();
    const steps = await runRingCheck({ ...config, timeoutMs: 150 });
    expect(step(steps, 'one live read')?.detail).toBe('no answer within 0 s');
    expect(Date.now() - started).toBeLessThan(4_000);
  });
});

describe('when Ujuzi’s answer does not match its own contract (a genuine problem, not a missing system)', () => {
  it('fails the contract and types steps for an answer with missing fields, pointing at H1', async () => {
    ujuzi().mode = 'wrongShape';
    const steps = await runRingCheck(config);
    expect(step(steps, 'one live read')?.ok).toBe(true); // it did answer
    expect(step(steps, "fits Ujuzi's contract")).toMatchObject({ ok: false, held: expect.stringContaining('H1') });
    expect(step(steps, 'types/ujuzi.d.ts')).toMatchObject({ ok: false });
    expect(step(steps, 'types/ujuzi.d.ts')?.detail).toMatch(/centre|category|county/); // the compiler names what is missing
  });

  it('catches a field the contract’s types do not have, which the contract check alone lets through', async () => {
    ujuzi().extraCourseField = true;
    const steps = await runRingCheck(config);
    expect(step(steps, "fits Ujuzi's contract")?.ok).toBe(true);
    expect(step(steps, 'types/ujuzi.d.ts')).toMatchObject({ ok: false });
    expect(step(steps, 'types/ujuzi.d.ts')?.detail).toContain('rating');
  });
});

describe('when Sherehe’s own deployment is not right', () => {
  it('fails, naming H8, when it refuses Kazi’s key', async () => {
    const steps = await runRingCheck({ ...config, sherehePartnerKey: 'a-key-we-never-issued' });
    expect(step(steps, 'Sherehe: GET /api/events?status=upcoming')).toMatchObject({ ok: false, held: expect.stringContaining('H8') });
    expect(step(steps, 'Sherehe: GET /api/events?status=upcoming')?.detail).toContain('refused the partner key');
    expect(step(steps, 'without a key is refused')?.ok).toBe(true);
  });

  it('fails the key rule (R4) when the deployment has no keys and answers anyone', async () => {
    process.env.PARTNER_KEYS = '';
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const steps = await runRingCheck(config);
    expect(step(steps, 'without a key is refused')).toMatchObject({ ok: false, held: expect.stringContaining('H8') });
    expect(step(steps, 'without a key is refused')?.detail).toContain('open to anyone');
    warn.mockRestore();
  });

  it('fails when there is no Sherehe URL', async () => {
    const steps = await runRingCheck({ ...config, shereheUrl: undefined });
    expect(failures(steps).map((s) => s.detail)).toContain('SHEREHE_URL is not set');
  });

  it('reports Ujuzi trouble seen from the deployment, as a 502, with the held items', async () => {
    const log = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    ujuzi().mode = 'down';
    process.env.UJUZI_TIMEOUT_MS = '500';
    const steps = await runRingCheck(config);
    expect(step(steps, 'through the deployment')).toMatchObject({ ok: false, held: expect.stringMatching(/H2.*H3/) });
    expect(step(steps, 'through the deployment')?.detail).toContain('could not reach Ujuzi');
    expect(step(steps, 'Sherehe: GET /api/events?status=upcoming')?.ok).toBe(true); // Sherehe's own pages are unaffected (R7)
    log.mockRestore();
  });

  it('fails the login step for a check account that does not exist', async () => {
    const steps = await runRingCheck({ ...config, checkPassword: 'wrong password' });
    expect(step(steps, 'log in with the check account')).toMatchObject({ ok: false, detail: 'answered 401' });
  });
});

describe('the report', () => {
  it('lists every step with PASS or FAIL, names held items under the failures, and counts them', async () => {
    ujuzi().mode = 'down';
    const steps = await runRingCheck(config);
    const report = formatReport(steps, config);
    expect(report).toMatch(/^Ring check, \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/);
    expect(report).toContain('FAIL  Ujuzi: one live read');
    expect(report).toContain('Probably waiting on another system: H2');
    expect(report).toContain('PASS  Sherehe: GET /api/events?status=upcoming');
    expect(report).toMatch(/\d of \d steps failed\. If they all name a held item, run the held-issues-checker agent/);
  });
});

describe('npm run ring:check (the command line)', () => {
  const exec = promisify(execFile);
  const cli = (extra: string[] = [], env: { [k: string]: string } = {}) =>
    exec('npx', ['tsx', 'scripts/ringCheck.ts', ...extra], {
      env: {
        PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', UJUZI_API_URL: config.ujuziUrl ?? '', UJUZI_API_KEY: UJUZI_KEY,
        SHEREHE_URL: config.shereheUrl ?? '', SHEREHE_PARTNER_KEY: KAZI_KEY, SHEREHE_CHECK_EMAIL: EMAIL, SHEREHE_CHECK_PASSWORD: PASSWORD, ...env,
      },
      timeout: 60_000,
    } as unknown as Parameters<typeof exec>[2]).then((r) => ({ code: 0, out: r.stdout, err: r.stderr }), (e: { code?: number; stdout?: string; stderr?: string }) => ({ code: e.code ?? 1, out: e.stdout ?? '', err: e.stderr ?? '' }));

  it('exits 0 and prints the report when everything passes', async () => {
    const run = await cli();
    expect(run.code).toBe(0);
    expect(run.out).toContain('All 8 steps passed.');
    expect(run.out).not.toContain(KAZI_KEY);
  });

  it('exits 1 when a step fails', async () => {
    const run = await cli([], { UJUZI_API_KEY: 'wrong' });
    expect(run.code).toBe(1);
    expect(run.out).toContain('FAIL  Ujuzi: one live read');
  });

  it('refuses to save evidence from a run against local URLs, because evidence/ring/ is for the real deployments', async () => {
    const run = await cli(['--save']);
    expect(run.out).toContain('All 8 steps passed.');
    expect(run.err).toContain('Not saved');
  });
});
