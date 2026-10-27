/**
 * `npm run ring:check` (R9): is Sherehe's corner of the ring working end to end, for real?
 *
 *   1. One live read from Ujuzi, with Sherehe's real key.
 *   2. That answer checked against Ujuzi's contract and against types/ujuzi.d.ts.
 *   3. Sherehe's own partner endpoints called on its deployment, the way Kazi Connect calls them,
 *      and checked against openapi.yaml, including that a call without a key is refused (R4).
 *   4. Optionally, a logged-in read through the deployment ("training options"), which proves the
 *      deployed Sherehe can reach Ujuzi too.
 *
 * It only reads. Nothing is created, changed or cancelled anywhere. It prints one PASS or FAIL line
 * per step, never a key, and exits 1 if anything failed. When a failure is the kind that simply
 * means another system is not finished, it says which HELD_ISSUES.md item that is, so the
 * held-issues-checker agent can sort it later.
 *
 * Settings (environment or .env; none of the keys are ever printed):
 *   UJUZI_API_URL, UJUZI_API_KEY        Ujuzi, and our key at Ujuzi
 *   SHEREHE_URL                         our own deployment, e.g. https://sherehe-xxxx.onrender.com
 *   SHEREHE_PARTNER_KEY                 a partner key the deployment accepts (the raw key, not its hash)
 *   SHEREHE_CHECK_EMAIL / _PASSWORD     optional: a real account on the deployment, for step 4
 *
 *   npm run ring:check                  # prints the report
 *   npm run ring:check -- --save        # also saves it in evidence/ring/ (only for real, non-local URLs)
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { loadEnvConfig } from '@next/env';
import { loadContract, makeAjv, misfit, responseSchema, type Contract, type Json } from './contractSchema';

const run = promisify(execFile);

export interface RingConfig {
  ujuziUrl?: string;
  ujuziKey?: string;
  shereheUrl?: string;
  sherehePartnerKey?: string;
  checkEmail?: string;
  checkPassword?: string;
  /** Milliseconds to wait for each request. A sleeping Render service needs most of a minute. */
  timeoutMs?: number;
  /** Pause before the one retry of a request that failed (default 5000: long enough for a service to start waking). */
  retryDelayMs?: number;
  /** Folder holding openapi.yaml, partner-tests/ and types/. Defaults to the current folder. */
  root?: string;
}

export interface Step {
  title: string;
  ok: boolean;
  detail: string;
  /** The HELD_ISSUES.md item that probably explains a failure (another system is not ready). */
  held?: string;
}

const HELD = {
  noUjuzi: 'H2 (no live Ujuzi yet)',
  ujuziKey: 'H3 (no key issued by Ujuzi yet)',
  coldStart: 'H4 (a sleeping Render service wakes slowly: wait a minute and run it again)',
  ujuziContract: 'H1 (Ujuzi has not handed off its real contract)',
  partnerKeys: 'H8 (partner keys not configured on the deployment yet)',
} as const;

interface Reply {
  status: number;
  body: unknown;
}

async function get(url: string, headers: { [name: string]: string }, timeoutMs: number, retryDelayMs = 5_000): Promise<Reply> {
  // Two tries: the first request to a Render service that has been idle can fail while it wakes up.
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json', ...headers }, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
      const text = await res.text();
      let body: unknown;
      try {
        body = text ? JSON.parse(text) : undefined;
      } catch {
        body = undefined;
      }
      if ([502, 503, 504].includes(res.status) && attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        continue;
      }
      return { status: res.status, body };
    } catch (err) {
      lastError = err;
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }
  const name = typeof lastError === 'object' && lastError !== null && 'name' in lastError ? String((lastError as { name: unknown }).name) : '';
  throw new Error(name === 'TimeoutError' || name === 'AbortError' ? `no answer within ${Math.round(timeoutMs / 1000)} s` : 'could not connect');
}

/** Assigns a live answer to the generated type, so the TypeScript compiler itself says if they disagree. */
async function checkAgainstTypes(root: string, typesFile: string, schemaName: string, sample: unknown): Promise<string | undefined> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ring-check-'));
  const file = path.join(dir, 'check.ts');
  const typesImport = path.join(root, 'types', typesFile).replace(/\\/g, '/').replace(/\.d\.ts$/, '');
  await fs.writeFile(file, `import type { components } from '${typesImport}';\nexport const live: components['schemas']['${schemaName}'] = ${JSON.stringify(sample, null, 2)};\n`);
  try {
    await run(path.join(root, 'node_modules', '.bin', 'tsc'), ['--ignoreConfig', '--noEmit', '--strict', '--skipLibCheck', '--target', 'es2022', '--module', 'esnext', '--moduleResolution', 'bundler', file], { timeout: 60_000 });
    return undefined;
  } catch (err) {
    // tsc prints its errors on stdout. Looked up by shape, not instanceof, which is false for errors
    // from another realm (as under Jest).
    const output = typeof err === 'object' && err !== null && 'stdout' in err ? String((err as { stdout: unknown }).stdout) : String(err);
    const line = output.split('\n').find((l) => l.includes('error TS')) ?? output.split('\n')[0] ?? 'the compiler rejected it';
    return line.replace(/^.*error TS\d+:\s*/, '').trim();
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const trim = (url: string) => url.trim().replace(/\/+$/, '');

export async function runRingCheck(config: RingConfig): Promise<Step[]> {
  const root = config.root ?? process.cwd();
  const timeout = config.timeoutMs ?? 65_000;
  const pause = config.retryDelayMs;
  const steps: Step[] = [];
  const add = (step: Step) => steps.push(step);

  // ---- 1 and 2: Ujuzi ---------------------------------------------------------------------------
  const ujuziContract = loadContract(path.join(root, 'partner-tests', 'ujuzi_openapi.yaml'));
  const ajv = makeAjv();
  if (!config.ujuziUrl?.trim()) {
    add({ title: 'Ujuzi: one live read', ok: false, detail: 'UJUZI_API_URL is not set', held: HELD.noUjuzi });
  } else {
    const base = trim(config.ujuziUrl);
    let courses: unknown;
    try {
      const res = await get(`${base}/api/courses`, config.ujuziKey ? { 'X-API-Key': config.ujuziKey } : {}, timeout, pause);
      if (res.status === 200 && Array.isArray(res.body)) {
        courses = res.body;
        add({ title: 'Ujuzi: one live read (GET /api/courses)', ok: true, detail: `200, ${res.body.length} course${res.body.length === 1 ? '' : 's'}${config.ujuziKey ? ', with our key' : ', without a key (none is set)'}` });
      } else if (res.status === 401 || res.status === 403) {
        add({ title: 'Ujuzi: one live read (GET /api/courses)', ok: false, detail: `Ujuzi answered ${res.status}: it ${config.ujuziKey ? 'did not accept our key' : 'wants a key and none is set (UJUZI_API_KEY)'}`, held: HELD.ujuziKey });
      } else if (res.status === 200) {
        add({ title: 'Ujuzi: one live read (GET /api/courses)', ok: false, detail: 'Ujuzi answered 200 but not with a JSON list', held: HELD.ujuziContract });
      } else {
        add({ title: 'Ujuzi: one live read (GET /api/courses)', ok: false, detail: `Ujuzi answered ${res.status}`, held: res.status >= 500 ? HELD.coldStart : HELD.ujuziContract });
      }
    } catch (err) {
      add({ title: 'Ujuzi: one live read (GET /api/courses)', ok: false, detail: err instanceof Error ? err.message : 'failed', held: `${HELD.noUjuzi}, or ${HELD.coldStart}` });
    }

    if (Array.isArray(courses)) {
      const schema = responseSchema(ujuziContract, '/api/courses', 'get', 200);
      const why = misfit(ajv, schema, courses);
      add({
        title: "Ujuzi: the answer fits Ujuzi's contract (partner-tests/ujuzi_openapi.yaml)",
        ok: why === undefined,
        detail: why ?? `all ${courses.length} course${courses.length === 1 ? '' : 's'} match`,
        held: why ? HELD.ujuziContract : undefined,
      });
      if (courses.length > 0) {
        const why2 = await checkAgainstTypes(root, 'ujuzi.d.ts', 'Course', courses[0]);
        add({
          title: 'Ujuzi: the first course is assignable to types/ujuzi.d.ts (Course)',
          ok: why2 === undefined,
          detail: why2 ?? 'the compiler accepts it',
          held: why2 ? HELD.ujuziContract : undefined,
        });
      } else {
        add({ title: 'Ujuzi: the first course is assignable to types/ujuzi.d.ts (Course)', ok: true, detail: 'Ujuzi has no courses yet, so there is nothing to compare (not a failure)' });
      }
    }
  }

  // ---- 3: Sherehe's own partner endpoints, the way Kazi calls them --------------------------------
  if (!config.shereheUrl?.trim()) {
    add({ title: "Sherehe: partner endpoints on the deployment", ok: false, detail: 'SHEREHE_URL is not set' });
    return steps;
  }
  const own = trim(config.shereheUrl);
  const ownContract: Contract = loadContract(path.join(root, 'openapi.yaml'));
  const key: { [name: string]: string } = config.sherehePartnerKey ? { 'X-API-Key': config.sherehePartnerKey } : {};
  const fitsOurs = (route: string, status: number, body: unknown) => misfit(ajv, responseSchema(ownContract, route, 'get', status), body);

  try {
    const list = await get(`${own}/api/events?status=upcoming`, key, timeout, pause);
    if (list.status !== 200 || !Array.isArray(list.body)) {
      add({
        title: 'Sherehe: GET /api/events?status=upcoming',
        ok: false,
        detail: list.status === 401 ? 'the deployment refused the partner key (401)' : `answered ${list.status}`,
        held: list.status === 401 ? HELD.partnerKeys : HELD.coldStart,
      });
    } else {
      const why = fitsOurs('/api/events', 200, list.body);
      add({ title: 'Sherehe: GET /api/events?status=upcoming', ok: !why, detail: why ?? `200, ${list.body.length} event${list.body.length === 1 ? '' : 's'}, all match openapi.yaml` });

      const first = (list.body as Array<{ id?: string }>)[0]?.id;
      if (first) {
        const one = await get(`${own}/api/events/${encodeURIComponent(first)}`, key, timeout, pause);
        const oneWhy = one.status === 200 ? fitsOurs('/api/events/{eventId}', 200, one.body) : `answered ${one.status}`;
        add({ title: `Sherehe: GET /api/events/${first}`, ok: !oneWhy, detail: oneWhy ?? '200, matches openapi.yaml' });
        const roles = await get(`${own}/api/events/${encodeURIComponent(first)}/roles`, key, timeout, pause);
        const rolesWhy = roles.status === 200 ? fitsOurs('/api/events/{eventId}/roles', 200, roles.body) : `answered ${roles.status}`;
        add({ title: `Sherehe: GET /api/events/${first}/roles`, ok: !rolesWhy, detail: rolesWhy ?? `200, ${(roles.body as unknown[]).length} role(s), all match openapi.yaml` });
      } else {
        add({ title: 'Sherehe: one event and its roles', ok: true, detail: 'the deployment has no upcoming events to read (not a failure)' });
      }
    }

    // R4: without a key the answer must be 401 { message }.
    const open = await get(`${own}/api/events?status=upcoming`, {}, timeout, pause);
    const refusedWhy = open.status === 401 ? fitsOurs('/api/events', 401, open.body) : undefined;
    add({
      title: 'Sherehe: a call without a key is refused (R4)',
      ok: open.status === 401 && !refusedWhy,
      detail: open.status === 401 ? (refusedWhy ?? '401 { message }, as the contract says') : `answered ${open.status}: the partner endpoints are open to anyone`,
      held: open.status === 401 ? undefined : HELD.partnerKeys,
    });
  } catch (err) {
    add({ title: 'Sherehe: partner endpoints on the deployment', ok: false, detail: err instanceof Error ? err.message : 'failed', held: HELD.coldStart });
  }

  // ---- 4: the deployment reaching Ujuzi, as an organiser would -----------------------------------
  if (config.checkEmail && config.checkPassword) {
    try {
      const login = await fetch(`${own}/api/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ email: config.checkEmail, password: config.checkPassword }), signal: AbortSignal.timeout(timeout),
      });
      const loginBody = (await login.json().catch(() => undefined)) as { token?: string } | undefined;
      if (login.status !== 200 || !loginBody?.token) {
        add({ title: 'Sherehe: log in with the check account', ok: false, detail: `answered ${login.status}` });
      } else {
        const options = await get(`${own}/api/training-options`, { Authorization: `Bearer ${loginBody.token}` }, timeout, pause);
        add({
          title: 'Sherehe -> Ujuzi: GET /api/training-options through the deployment',
          ok: options.status === 200 && Array.isArray(options.body),
          detail: options.status === 200 ? `200, ${(options.body as unknown[]).length} course(s) read through Ujuzi` : `answered ${options.status}${options.status === 502 ? ': the deployment could not reach Ujuzi' : ''}`,
          held: options.status === 502 ? `${HELD.noUjuzi}, ${HELD.ujuziKey}` : undefined,
        });
        await fetch(`${own}/api/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${loginBody.token}` } }).catch(() => undefined);
      }
    } catch (err) {
      add({ title: 'Sherehe -> Ujuzi: through the deployment', ok: false, detail: err instanceof Error ? err.message : 'failed', held: HELD.coldStart });
    }
  } else {
    add({ title: 'Sherehe -> Ujuzi: through the deployment', ok: true, detail: 'skipped: set SHEREHE_CHECK_EMAIL and SHEREHE_CHECK_PASSWORD to include it' });
  }
  return steps;
}

export function formatReport(steps: Step[], config: RingConfig): string {
  const lines = [`Ring check, ${new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')}`, `Ujuzi:   ${config.ujuziUrl || '(not set)'}`, `Sherehe: ${config.shereheUrl || '(not set)'}`, ''];
  for (const s of steps) {
    lines.push(`${s.ok ? 'PASS' : 'FAIL'}  ${s.title}`, `      ${s.detail}`);
    if (!s.ok && s.held) lines.push(`      Probably waiting on another system: ${s.held}. See HELD_ISSUES.md.`);
  }
  const failed = steps.filter((s) => !s.ok).length;
  lines.push('', failed === 0 ? `All ${steps.length} steps passed.` : `${failed} of ${steps.length} steps failed. If they all name a held item, run the held-issues-checker agent once the other systems are ready.`);
  return lines.join('\n') + '\n';
}

const isLocal = (url?: string) => !url || /^(https?:\/\/)?(localhost|127\.|\[::1\]|0\.0\.0\.0)/i.test(url.trim());

// `npm run ring:check`
if (path.basename(process.argv[1] ?? '') === 'ringCheck.ts') {
  loadEnvConfig(process.cwd());
  const env = process.env;
  const config: RingConfig = {
    ujuziUrl: env.UJUZI_API_URL, ujuziKey: env.UJUZI_API_KEY, shereheUrl: env.SHEREHE_URL, sherehePartnerKey: env.SHEREHE_PARTNER_KEY,
    checkEmail: env.SHEREHE_CHECK_EMAIL, checkPassword: env.SHEREHE_CHECK_PASSWORD,
  };
  runRingCheck(config)
    .then(async (steps) => {
      const report = formatReport(steps, config);
      process.stdout.write(report);
      if (process.argv.includes('--save')) {
        if (isLocal(config.ujuziUrl) || isLocal(config.shereheUrl)) {
          console.error('Not saved: evidence/ring/ is for runs against the real deployments, and one of the URLs is local or missing.');
        } else {
          const file = path.join('evidence', 'ring', `ring-check-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}Z.txt`);
          await fs.mkdir(path.dirname(file), { recursive: true });
          await fs.writeFile(file, report);
          console.log(`Saved ${file}`);
        }
      }
      process.exitCode = steps.every((s) => s.ok) ? 0 : 1;
    })
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    });
}

export type { Json };
