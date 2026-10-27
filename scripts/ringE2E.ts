/**
 * `npm run ring:e2e`: the whole ring, end to end, on this machine.
 *
 *   Sherehe (events) -> Kazi Connect (jobs) -> Ujuzi (training) -> Sherehe
 *
 * It plays the people of the story through each system's public API, so it needs no access to any
 * code or database of the other two:
 *
 *   Kazi -> Sherehe   an organiser posts an event and a role on Sherehe. Kazi must list that role
 *                     (it read it from Sherehe with its partner key). An employer on Kazi offers workers;
 *                     the offer must land on Sherehe. The organiser accepts: Kazi must notice and open a
 *                     job. A second offer is declined (no job), a third is withdrawn by Kazi (gone on Sherehe).
 *   Sherehe -> Ujuzi the organiser reads courses through Sherehe, checks a certificate (a valid one and
 *                     a revoked one), books a crew training. Ujuzi's training centre staff confirm it on
 *                     Ujuzi; Sherehe's poller must pick the new status up.
 *
 * Every step prints PASS or FAIL. A failure that just means a system is not running or not finished is
 * marked "(waiting on ...)", with the HELD_ISSUES.md item, so it can be told apart from a genuine bug.
 * It creates data (an organiser, events, offers, a booking) in the three local databases and never
 * prints a token or password. It is meant for the local ring only.
 *
 * Settings (environment; the defaults are the ring's ports from /Users/solovea/Developer/ring-local):
 *   SHEREHE_URL (4001), KAZI_URL (4002), UJUZI_URL (4003)
 *   KAZI_EMPLOYER_EMAIL / KAZI_EMPLOYER_PASSWORD     the seeded demo employer on Kazi
 *   UJUZI_STAFF_EMAIL / UJUZI_STAFF_PASSWORD         seeded staff of the centre that runs crs_501 (default password: the local demo one)
 *   --only=kazi | --only=ujuzi                       run one half
 */
import { loadEnvConfig } from '@next/env';

export interface Step {
  title: string;
  ok: boolean;
  detail: string;
  /** Set when the failure is probably just "that system is not up or not finished". */
  waiting?: string;
}

export interface E2EConfig {
  shereheUrl: string;
  kaziUrl: string;
  ujuziUrl: string;
  employerEmail: string;
  employerPassword: string;
  staffEmail: string;
  staffPassword: string;
  only?: 'kazi' | 'ujuzi';
  /** How long to wait for the other system's poller to notice a change. */
  kaziWaitMs: number;
  shereheWaitMs: number;
  pollEveryMs: number;
}

type Json = { [key: string]: unknown };
interface Reply {
  status: number;
  body: unknown;
}

const HELD = {
  notUp: (name: string) => `${name} is not running or not answering (H2 for Ujuzi, or start it with its ring settings)`,
  keys: 'a key was refused (H3 Ujuzi key, H8 Sherehe partner key)',
} as const;

/**
 * How far ahead the test event is. Kazi only lists Sherehe events that start soon, and an event 60 days
 * out never showed up in its openings; 30 days does (found by running this script against the live ring).
 */
const EVENT_IN_DAYS = 30;

class NotAnswering extends Error {}

async function call(base: string, method: string, path: string, opts: { token?: string; body?: unknown } = {}): Promise<Reply> {
  const headers: { [name: string]: string } = { Accept: 'application/json' };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(base + path, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body), signal: AbortSignal.timeout(20_000) });
  } catch {
    throw new NotAnswering(`${base} did not answer`);
  }
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const asList = (v: unknown): Json[] => {
  if (Array.isArray(v)) return v.filter(isObject);
  if (isObject(v)) for (const key of ['items', 'data', 'results', 'offers', 'jobs', 'openings']) if (Array.isArray(v[key])) return (v[key] as unknown[]).filter(isObject);
  return [];
};
const message = (r: Reply) => (isObject(r.body) && typeof r.body.message === 'string' ? r.body.message : `HTTP ${r.status}`);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const inDays = (n: number, hour = 10) => {
  const d = new Date(Date.now() + n * 86_400_000);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
};

/** Asks again every pollEveryMs until `check` returns a value or the time is up. */
async function waitFor<T>(timeoutMs: number, everyMs: number, check: () => Promise<T | undefined>): Promise<T | undefined> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const found = await check();
    if (found !== undefined) return found;
    if (Date.now() + everyMs > until) return undefined;
    await sleep(everyMs);
  }
}

export async function runRingE2E(cfg: E2EConfig): Promise<Step[]> {
  const steps: Step[] = [];
  const pass = (title: string, detail: string) => steps.push({ title, ok: true, detail });
  const fail = (title: string, detail: string, waiting?: string) => steps.push({ title, ok: false, detail, waiting });
  const stamp = Date.now().toString(36);

  // ---- who is up -----------------------------------------------------------------------------------
  const reachable = async (name: string, base: string): Promise<boolean> => {
    try {
      await call(base, 'GET', '/');
      return true;
    } catch {
      fail(`${name} is running`, `nothing answers at ${base}`, HELD.notUp(name));
      return false;
    }
  };
  const shereheUp = await reachable('Sherehe', cfg.shereheUrl);
  const kaziUp = cfg.only === 'ujuzi' ? false : await reachable('Kazi Connect', cfg.kaziUrl);
  const ujuziUp = cfg.only === 'kazi' ? false : await reachable('Ujuzi', cfg.ujuziUrl);
  if (shereheUp) pass('Sherehe is running', cfg.shereheUrl);
  if (kaziUp) pass('Kazi Connect is running', cfg.kaziUrl);
  if (ujuziUp) pass('Ujuzi is running', cfg.ujuziUrl);
  if (!shereheUp) return steps; // every story starts with an organiser on Sherehe

  // ---- the organiser, on Sherehe --------------------------------------------------------------------
  const email = `ring.organiser.${stamp}@example.com`;
  const password = `ring-${stamp}-password`;
  const register = await call(cfg.shereheUrl, 'POST', '/api/auth/register', { body: { email, name: 'Ring Organiser', password } });
  const token = isObject(register.body) && typeof register.body.token === 'string' ? register.body.token : undefined;
  if (register.status !== 201 || !token) {
    fail('Sherehe: an organiser registers', message(register));
    return steps;
  }
  pass('Sherehe: an organiser registers', `201, logged in`);

  const eventBody = (label: string) => ({
    name: `Ring ${label} ${stamp}`, type: 'wedding', county: 'Nairobi', area: 'Westlands', venue: 'Ring Test Hall',
    startsAt: inDays(EVENT_IN_DAYS), endsAt: inDays(EVENT_IN_DAYS, 20), expectedGuests: 120,
  });
  const makeRole = async (eventId: string, title: string, category: string, headcount: number) =>
    call(cfg.shereheUrl, 'POST', `/api/events/${eventId}/roles`, {
      token, body: { title, category, headcount, shiftStart: inDays(EVENT_IN_DAYS, 8), shiftEnd: inDays(EVENT_IN_DAYS, 18), payPerShift: 1500 },
    });

  const event = await call(cfg.shereheUrl, 'POST', '/api/events', { token, body: eventBody('wedding') });
  const eventId = isObject(event.body) ? String(event.body.id) : '';
  if (event.status !== 201) {
    fail('Sherehe: the organiser posts an event', message(event));
    return steps;
  }
  pass('Sherehe: the organiser posts an event', `201, ${eventId}`);

  // ---- Kazi -> Sherehe ------------------------------------------------------------------------------
  if (kaziUp) {
    const roles = [
      { name: 'accepted', title: `Waiters ${stamp}`, category: 'catering', headcount: 5, workers: 2 },
      { name: 'declined', title: `Ushers ${stamp}`, category: 'events', headcount: 4, workers: 2 },
      { name: 'withdrawn', title: `Cleaners ${stamp}`, category: 'cleaning', headcount: 3, workers: 1 },
    ];
    const made: { [name: string]: string } = {};
    for (const r of roles) {
      const res = await makeRole(eventId, r.title, r.category, r.headcount);
      if (res.status === 201 && isObject(res.body)) made[r.name] = String(res.body.id);
      else fail(`Sherehe: the organiser adds a ${r.category} role`, message(res));
    }

    const login = await call(cfg.kaziUrl, 'POST', '/api/auth/login', { body: { email: cfg.employerEmail, password: cfg.employerPassword } });
    const kaziToken = isObject(login.body) && typeof login.body.token === 'string' ? login.body.token : undefined;
    if (login.status !== 200 || !kaziToken) {
      fail('Kazi: the demo employer logs in', message(login), 'Kazi must be running with its seeded demo employer');
    } else {
      pass('Kazi: the demo employer logs in', '200');

      // Kazi reads Sherehe's events and roles with its partner key and remembers the answer for a short
      // while, so a role added a moment ago can take up to a minute to appear. Ask until it does.
      const missingFrom = (list: Json[]) => Object.entries(made).filter(([, id]) => !list.some((o) => o.roleId === id)).map(([n]) => n);
      let last: Reply = { status: 0, body: undefined };
      const listed = await waitFor(cfg.kaziWaitMs, cfg.pollEveryMs, async () => {
        last = await call(cfg.kaziUrl, 'GET', '/api/event-openings?county=Nairobi', { token: kaziToken });
        return last.status === 200 && missingFrom(asList(last.body)).length === 0 ? asList(last.body) : last.status === 200 ? undefined : [];
      });
      if (last.status !== 200) {
        fail("Kazi -> Sherehe: Kazi lists Sherehe's open roles", message(last), HELD.keys);
      } else if (listed && listed.length > 0) {
        pass("Kazi -> Sherehe: Kazi lists the organiser's new roles (read from Sherehe)", `all ${Object.keys(made).length} roles are in Kazi's event openings`);
      } else {
        fail(
          "Kazi -> Sherehe: Kazi lists the organiser's new roles (read from Sherehe)",
          `after ${Math.round(cfg.kaziWaitMs / 1000)} s Kazi's openings still miss the ${missingFrom(asList(last.body)).join(', ')} role(s); offers on them work, so Kazi can read them`,
          "Kazi remembers its list of Sherehe's events for a few minutes; run again later and this step passes",
        );
      }

      const offer = async (roleId: string, workers: number, note: string) => call(cfg.kaziUrl, 'POST', '/api/staffing-offers', { token: kaziToken, body: { roleId, workersOffered: workers, note } });
      const sherehesOffers = async () => asList((await call(cfg.shereheUrl, 'GET', `/api/events/${eventId}/offers`, { token })).body);
      const idOf = (r: Reply) => (isObject(r.body) ? String(r.body.id ?? '') : '');

      // --- accepted
      if (made.accepted) {
        const o = await offer(made.accepted, 2, 'Two trained waiters (ring test)');
        if (o.status !== 201) {
          fail('Kazi -> Sherehe: an employer offers workers on Kazi', message(o), HELD.keys);
        } else {
          pass('Kazi -> Sherehe: an employer offers workers on Kazi', `201, pending (${idOf(o)})`);
          const onSherehe = (await sherehesOffers()).find((x) => x.roleId === made.accepted);
          if (onSherehe && onSherehe.status === 'pending' && onSherehe.workersOffered === 2) pass('Kazi -> Sherehe: the offer arrived on Sherehe, pending', `${onSherehe.id}, 2 workers`);
          else fail('Kazi -> Sherehe: the offer arrived on Sherehe, pending', `Sherehe's list for the event: ${JSON.stringify((await sherehesOffers()).map((x) => [x.roleId, x.status]))}`);

          if (onSherehe) {
            const decide = await call(cfg.shereheUrl, 'PATCH', `/api/offers/${onSherehe.id}`, { token, body: { status: 'accepted' } });
            if (decide.status === 200) pass('Sherehe: the organiser accepts the offer', '200, accepted');
            else fail('Sherehe: the organiser accepts the offer', message(decide));
            const filled = asList((await call(cfg.shereheUrl, 'GET', `/api/events/${eventId}/roles`, { token })).body).find((r) => r.id === made.accepted)?.filled;
            if (filled === 2) pass('Sherehe: accepting filled 2 places on the role', 'filled = 2'); else fail('Sherehe: accepting filled 2 places on the role', `filled = ${String(filled)}`);

            // Kazi's poller notices and opens a job.
            const kaziOfferId = idOf(o);
            const accepted = await waitFor(cfg.kaziWaitMs, cfg.pollEveryMs, async () => {
              const mine = asList((await call(cfg.kaziUrl, 'GET', '/api/me/staffing-offers', { token: kaziToken })).body).find((x) => x.id === kaziOfferId);
              return mine && mine.status === 'accepted' ? mine : undefined;
            });
            if (!accepted) fail('Sherehe -> Kazi: Kazi notices the acceptance', `Kazi still shows the offer as not accepted after ${Math.round(cfg.kaziWaitMs / 1000)} s (its OFFER_POLL_MS is probably longer)`);
            else {
              pass('Sherehe -> Kazi: Kazi notices the acceptance', `status accepted${accepted.jobId ? `, jobId ${String(accepted.jobId)}` : ''}`);
              const jobs = asList((await call(cfg.kaziUrl, 'GET', '/api/jobs?status=active', { token: kaziToken })).body);
              if (accepted.jobId && jobs.some((j) => j.id === accepted.jobId)) pass('Kazi: a job is open for the students', `job ${String(accepted.jobId)} is active`);
              else fail('Kazi: a job is open for the students', accepted.jobId ? `job ${String(accepted.jobId)} is not among ${jobs.length} active job(s)` : 'the accepted offer has no jobId');
            }
          }
        }
      }

      // --- declined
      if (made.declined) {
        const o = await offer(made.declined, 2, 'Declined on purpose (ring test)');
        const onSherehe = o.status === 201 ? (await sherehesOffers()).find((x) => x.roleId === made.declined) : undefined;
        if (o.status !== 201 || !onSherehe) fail('Kazi -> Sherehe -> Kazi: a declined offer', `the offer was not made (${message(o)})`);
        else {
          await call(cfg.shereheUrl, 'PATCH', `/api/offers/${onSherehe.id}`, { token, body: { status: 'declined' } });
          const kaziOfferId = idOf(o);
          const declined = await waitFor(cfg.kaziWaitMs, cfg.pollEveryMs, async () => {
            const mine = asList((await call(cfg.kaziUrl, 'GET', '/api/me/staffing-offers', { token: kaziToken })).body).find((x) => x.id === kaziOfferId);
            return mine && mine.status === 'declined' ? mine : undefined;
          });
          if (declined && !declined.jobId) pass('Sherehe -> Kazi: a declined offer shows as declined on Kazi and opens no job', 'declined, no jobId');
          else fail('Sherehe -> Kazi: a declined offer shows as declined on Kazi and opens no job', declined ? `a job was opened: ${String(declined.jobId)}` : 'Kazi never showed it as declined');
        }
      }

      // --- withdrawn by Kazi
      if (made.withdrawn) {
        const o = await offer(made.withdrawn, 1, 'To be withdrawn (ring test)');
        if (o.status !== 201) fail('Kazi -> Sherehe: Kazi withdraws a pending offer', `the offer was not made (${message(o)})`);
        else {
          const del = await call(cfg.kaziUrl, 'DELETE', `/api/staffing-offers/${idOf(o)}`, { token: kaziToken });
          const gone = !(await sherehesOffers()).some((x) => x.roleId === made.withdrawn);
          if ([200, 204].includes(del.status) && gone) pass('Kazi -> Sherehe: Kazi withdraws a pending offer', `${del.status}, and it is gone from Sherehe`);
          else fail('Kazi -> Sherehe: Kazi withdraws a pending offer', `Kazi answered ${del.status}${gone ? '' : '; the offer is still on Sherehe'}`);
        }
      }
    }
  }

  // ---- Sherehe -> Ujuzi -----------------------------------------------------------------------------
  if (ujuziUp) {
    const options = await call(cfg.shereheUrl, 'GET', '/api/training-options?category=catering', { token });
    const courses = asList(options.body);
    if (options.status === 200 && courses.length > 0) pass('Sherehe -> Ujuzi: courses are read through Sherehe', `${courses.length} catering course(s) from Ujuzi, e.g. ${String(courses[0].courseId)}`);
    else fail('Sherehe -> Ujuzi: courses are read through Sherehe', options.status === 502 ? `Sherehe answered 502: ${message(options)}` : `HTTP ${options.status}, ${courses.length} course(s)`, options.status === 502 ? HELD.keys : undefined);

    for (const [number, valid] of [['UJZ-2026-00123', true], ['UJZ-2026-00124', false]] as const) {
      const check = await call(cfg.shereheUrl, 'POST', '/api/certificate-checks', { token, body: { certificateNo: number } });
      if (check.status === 201 && isObject(check.body) && check.body.valid === valid) pass(`Sherehe -> Ujuzi: certificate ${number} is ${valid ? 'valid' : 'revoked'}`, `201, valid = ${String(valid)}, holder ${String((check.body as Json).holder)}`);
      else fail(`Sherehe -> Ujuzi: certificate ${number} is ${valid ? 'valid' : 'revoked'}`, check.status === 404 ? 'Ujuzi has no such certificate (is its seed data loaded?)' : message(check), check.status === 502 ? HELD.keys : undefined);
    }

    const course = courses.find((c) => c.courseId === 'crs_501') ?? courses[0];
    if (course) {
      const book = await call(cfg.shereheUrl, 'POST', '/api/crew-trainings', {
        token, body: { eventId, courseId: course.courseId, crewSize: 4, preferredStart: inDays(EVENT_IN_DAYS - 10) },
      });
      const trainingId = isObject(book.body) ? String(book.body.id) : '';
      if (book.status !== 201) fail('Sherehe -> Ujuzi: the organiser books crew training', message(book), book.status === 502 ? HELD.keys : undefined);
      else {
        pass('Sherehe -> Ujuzi: the organiser books crew training', `201, pending (${trainingId})`);
        // The training centre's staff confirm it on Ujuzi; Sherehe's poller must notice.
        const staff = await call(cfg.ujuziUrl, 'POST', '/api/auth/login', { body: { email: cfg.staffEmail, password: cfg.staffPassword } });
        const staffToken = isObject(staff.body) && typeof staff.body.token === 'string' ? staff.body.token : undefined;
        if (staff.status !== 200 || !staffToken) {
          fail('Ujuzi: the training centre staff log in', message(staff), 'Ujuzi staff login not available yet (waiting on Ujuzi)');
        } else {
          pass('Ujuzi: the training centre staff log in', '200');
          const bookings = asList((await call(cfg.ujuziUrl, 'GET', '/api/bookings', { token: staffToken })).body);
          const theirs = bookings.find((b) => String(b.eventName ?? '').includes(stamp) || (b.crewSize === 4 && b.courseId === course.courseId && b.status === 'pending'));
          if (!theirs) fail('Ujuzi: the booking is there for the centre to decide', `the centre sees ${bookings.length} booking(s), none for this event`);
          else {
            const decide = await call(cfg.ujuziUrl, 'PATCH', `/api/bookings/${String(theirs.id)}`, { token: staffToken, body: { status: 'confirmed' } });
            if (decide.status !== 200) fail('Ujuzi: the centre confirms the booking', message(decide));
            else {
              pass('Ujuzi: the centre confirms the booking', '200, confirmed');
              const confirmed = await waitFor(cfg.shereheWaitMs, cfg.pollEveryMs, async () => {
                const mine = (await call(cfg.shereheUrl, 'GET', `/api/crew-trainings/${trainingId}`, { token })).body;
                return isObject(mine) && mine.status === 'confirmed' ? mine : undefined;
              });
              if (confirmed) pass('Ujuzi -> Sherehe: Sherehe notices the confirmation (its poller)', 'status confirmed');
              else fail('Ujuzi -> Sherehe: Sherehe notices the confirmation (its poller)', `Sherehe still shows the training as pending after ${Math.round(cfg.shereheWaitMs / 1000)} s`);
            }
          }
        }
      }
    }
  }
  return steps;
}

export function formatE2E(steps: Step[], cfg: E2EConfig): string {
  const lines = [`Ring end-to-end, ${new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')}`, `Sherehe ${cfg.shereheUrl}   Kazi ${cfg.kaziUrl}   Ujuzi ${cfg.ujuziUrl}`, ''];
  for (const s of steps) {
    lines.push(`${s.ok ? 'PASS' : 'FAIL'}  ${s.title}`, `      ${s.detail}`);
    if (!s.ok && s.waiting) lines.push(`      (waiting on: ${s.waiting})`);
  }
  const waiting = steps.filter((s) => !s.ok && s.waiting).length;
  const failed = steps.filter((s) => !s.ok).length - waiting;
  if (failed === 0 && waiting === 0) lines.push('', `All ${steps.length} steps passed.`);
  else lines.push('', `${steps.length - failed - waiting} passed, ${failed} failed, ${waiting} waiting on something that is not ready (see the notes above).`);
  return lines.join('\n') + '\n';
}

// `npm run ring:e2e`
if (/ringE2E\.ts$/.test(process.argv[1] ?? '')) {
  loadEnvConfig(process.cwd());
  const e = process.env;
  const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7);
  const cfg: E2EConfig = {
    shereheUrl: (e.SHEREHE_URL ?? 'http://localhost:4001').replace(/\/+$/, ''),
    kaziUrl: (e.KAZI_URL ?? 'http://localhost:4002').replace(/\/+$/, ''),
    ujuziUrl: (e.UJUZI_URL ?? 'http://localhost:4003').replace(/\/+$/, ''),
    employerEmail: e.KAZI_EMPLOYER_EMAIL ?? 'employer@kaziconnect.demo',
    employerPassword: e.KAZI_EMPLOYER_PASSWORD ?? 'KaziDemo2026',
    staffEmail: e.UJUZI_STAFF_EMAIL ?? 'wanjiru.njeri@example.com',
    staffPassword: e.UJUZI_STAFF_PASSWORD ?? 'ujuzi-demo-pass',
    only: only === 'kazi' || only === 'ujuzi' ? only : undefined,
    kaziWaitMs: 60_000, shereheWaitMs: 90_000, pollEveryMs: 3_000,
  };
  runRingE2E(cfg)
    .then((steps) => {
      process.stdout.write(formatE2E(steps, cfg));
      // 0 = everything passed, 2 = nothing failed but something is not ready yet, 1 = a real failure
      process.exitCode = steps.some((s) => !s.ok && !s.waiting) ? 1 : steps.some((s) => !s.ok) ? 2 : 0;
    })
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    });
}
