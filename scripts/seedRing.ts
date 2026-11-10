/**
 * `npm run seed:ring`: puts a realistic set of entries into each of the three systems, through their
 * public APIs only (nothing reads or writes another system's database), so every system has well over
 * 15 records of its own:
 *
 *   Sherehe       15 events, 38 staffing roles, 15 offers (6 accepted, 3 declined, 6 waiting), 10 crew trainings
 *   Kazi Connect  15 jobs, 15 student accounts, 15 applications (3 accepted)
 *   Ujuzi         8 new courses (17 in all), 15 graduates, 15 enrolments, 15 certificates, 15 applications
 *
 * It is safe to run again: anything that already exists is counted as "already there" and skipped.
 * Registrations are paced by Retry-After, because each system allows only about 10 sign-ups a minute.
 *
 * Settings (environment). The defaults are the local ring's addresses and demo accounts:
 *   SHEREHE_URL (4001)  SHEREHE_PARTNER_KEY      the raw key Kazi Connect uses for Sherehe (needed for the offers)
 *   KAZI_URL (4002)     KAZI_API_KEY             Kazi Connect's own key, when it asks callers for one
 *                       KAZI_EMPLOYER_EMAIL / KAZI_EMPLOYER_PASSWORD
 *   UJUZI_URL (4003)    UJUZI_STAFF_PASSWORD     the password of Ujuzi's demo staff (ujuzi-demo-pass)
 *   SEED_PASSWORD       the password given to every account this script creates (8 or more characters)
 *   --only=sherehe|kazi|ujuzi   seed one system.   --check   only count, create nothing.
 *
 * The accounts it makes are demo accounts with a shared password: do not leave them on a real deployment.
 */
import { loadEnvConfig } from '@next/env';

type Json = { [key: string]: unknown };
interface Reply {
  status: number;
  body: unknown;
}

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const asList = (v: unknown): Json[] => (Array.isArray(v) ? v.filter(isObject) : []);
const text = (v: unknown): string => (typeof v === 'string' ? v : '');
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const message = (r: Reply) => (isObject(r.body) && typeof r.body.message === 'string' ? r.body.message : `HTTP ${r.status}`);

/** A UTC date-time in the shape all three systems want: ISO 8601, a Z, no milliseconds. */
const at = (year: number, month: number, day: number, hour = 9): string =>
  new Date(Date.UTC(year, month - 1, day, hour, 0, 0)).toISOString().replace(/\.\d{3}Z$/, 'Z');

interface Config {
  sherehe: string;
  kazi: string;
  ujuzi: string;
  partnerKey: string | undefined;
  kaziKey: string | undefined;
  employerEmail: string;
  employerPassword: string;
  staffPassword: string;
  password: string;
}

class Seeder {
  readonly tally: { [label: string]: { created: number; existed: number; failed: number } } = {};
  readonly problems: string[] = [];
  constructor(readonly cfg: Config) {}

  say(line: string): void {
    process.stdout.write(`${line}\n`);
  }

  count(label: string, kind: 'created' | 'existed' | 'failed', why?: string): void {
    const t = (this.tally[label] ??= { created: 0, existed: 0, failed: 0 });
    t[kind] += 1;
    if (kind === 'failed' && why) this.problems.push(`${label}: ${why}`);
  }

  /** One request. A 429 is waited out (the system says for how long) and the request is sent again. */
  async call(base: string, method: string, path: string, opts: { token?: string; key?: string; body?: unknown } = {}): Promise<Reply> {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const headers: { [name: string]: string } = { Accept: 'application/json' };
      if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
      if (opts.key) headers['X-API-Key'] = opts.key;
      if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
      const res = await fetch(base + path, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body), signal: AbortSignal.timeout(45_000) });
      if (res.status === 429) {
        const wait = Math.min(75, Math.max(2, Number(res.headers.get('retry-after')) || 30));
        this.say(`    ...${new URL(base).port} asked us to wait ${wait} s (rate limit)`);
        await sleep(wait * 1000 + 500);
        continue;
      }
      const raw = await res.text();
      let body: unknown;
      try {
        body = raw ? JSON.parse(raw) : undefined;
      } catch {
        body = raw;
      }
      return { status: res.status, body };
    }
    return { status: 429, body: { message: 'still rate limited after waiting' } };
  }

  kazi(method: string, path: string, opts: { token?: string; body?: unknown } = {}): Promise<Reply> {
    return this.call(this.cfg.kazi, method, path, { ...opts, key: this.cfg.kaziKey });
  }
}

/** Registers an account, or logs in when the email is already registered. Returns the token and user. */
async function signUpOrIn(
  s: Seeder, base: string, label: string, register: Json, key?: string,
): Promise<{ token: string; user: Json } | null> {
  const made = await s.call(base, 'POST', '/api/auth/register', { body: register, key });
  let result = made;
  if (made.status === 409) {
    s.count(label, 'existed');
    result = await s.call(base, 'POST', '/api/auth/login', { body: { email: register.email, password: register.password }, key });
  } else if (made.status === 201) {
    s.count(label, 'created');
  } else {
    s.count(label, 'failed', `${text(register.email)}: ${message(made)}`);
    return null;
  }
  if (isObject(result.body) && typeof result.body.token === 'string') {
    return { token: result.body.token, user: isObject(result.body.user) ? result.body.user : {} };
  }
  s.count(label, 'failed', `${text(register.email)} could not log in: ${message(result)}`);
  return null;
}

// ---- the people (all fictional) --------------------------------------------------------------------
const PEOPLE: Array<[string, string]> = [
  ['Njeri', 'Wangari'], ['Brian', 'Mutiso'], ['Faith', 'Chebet'], ['Kevin', 'Odhiambo'], ['Mercy', 'Naliaka'],
  ['Dennis', 'Kariuki'], ['Zawadi', 'Mwende'], ['Samuel', 'Kiptoo'], ['Linet', 'Akoth'], ['Hassan', 'Mohamed'],
  ['Joyce', 'Wanjiru'], ['Victor', 'Ouma'], ['Esther', 'Njoki'], ['Abdi', 'Hussein'], ['Purity', 'Atieno'],
];
const emailOf = (first: string, last: string, system: string) => `${first}.${last}.${system}@example.com`.toLowerCase();

// ---- Ujuzi: courses, graduates, enrolments, certificates ------------------------------------------
const STAFF: Array<{ email: string; centreId: string }> = [
  { email: 'wanjiru.njeri@example.com', centreId: 'cen_11' },
  { email: 'peter.mwangi@example.com', centreId: 'cen_12' },
  { email: 'grace.wambui@example.com', centreId: 'cen_13' },
  { email: 'joseph.kiprop@example.com', centreId: 'cen_14' },
  { email: 'fatuma.hassan@example.com', centreId: 'cen_15' },
];

const NEW_COURSES: Array<{ staff: string; title: string; category: string; durationWeeks: number; feeKes: number; nextStart: string; certificateLevel: string }> = [
  { staff: 'wanjiru.njeri@example.com', title: 'Barista and beverage service', category: 'catering', durationWeeks: 3, feeKes: 4200, nextStart: at(2027, 2, 8, 8), certificateLevel: 'short-course' },
  { staff: 'wanjiru.njeri@example.com', title: 'Event ushering and guest management', category: 'events', durationWeeks: 2, feeKes: 3000, nextStart: at(2027, 2, 22, 8), certificateLevel: 'short-course' },
  { staff: 'peter.mwangi@example.com', title: 'Security guard licensing, grade III', category: 'security', durationWeeks: 4, feeKes: 5500, nextStart: at(2027, 2, 15, 8), certificateLevel: 'grade-III' },
  { staff: 'grace.wambui@example.com', title: 'Hotel housekeeping essentials', category: 'accommodation', durationWeeks: 3, feeKes: 3800, nextStart: at(2027, 3, 1, 8), certificateLevel: 'short-course' },
  { staff: 'grace.wambui@example.com', title: 'Event cleaning and waste handling', category: 'cleaning', durationWeeks: 2, feeKes: 2600, nextStart: at(2027, 3, 8, 8), certificateLevel: 'short-course' },
  { staff: 'joseph.kiprop@example.com', title: 'Basic electrical installation for events', category: 'electrical', durationWeeks: 6, feeKes: 7500, nextStart: at(2027, 2, 22, 8), certificateLevel: 'grade-II' },
  { staff: 'fatuma.hassan@example.com', title: 'Plumbing for event venues', category: 'plumbing', durationWeeks: 5, feeKes: 6800, nextStart: at(2027, 3, 15, 8), certificateLevel: 'grade-III' },
  { staff: 'fatuma.hassan@example.com', title: 'Peer tutoring and mentoring', category: 'tutoring', durationWeeks: 4, feeKes: 3200, nextStart: at(2027, 3, 22, 8), certificateLevel: 'short-course' },
];

interface UjuziWorld {
  staffTokens: { [email: string]: string };
  centreStaff: { [centreId: string]: string };
  graduateTokens: Array<{ token: string; id: string; email: string }>;
  courses: Json[];
  certificateNumbers: string[];
}

async function seedUjuziCourses(s: Seeder, world: UjuziWorld): Promise<void> {
  s.say('Ujuzi: staff log in, new courses');
  for (const staff of STAFF) {
    const r = await s.call(s.cfg.ujuzi, 'POST', '/api/auth/login', { body: { email: staff.email, password: s.cfg.staffPassword } });
    const token = isObject(r.body) ? text(r.body.token) : '';
    if (r.status !== 200 || !token) {
      s.count('Ujuzi · staff logins', 'failed', `${staff.email}: ${message(r)}`);
      continue;
    }
    world.staffTokens[staff.email] = token;
    const centre = isObject(r.body) && isObject(r.body.user) ? text(r.body.user.centreId) : staff.centreId;
    world.centreStaff[centre || staff.centreId] = token;
  }
  const anyStaff = Object.values(world.staffTokens)[0];
  if (!anyStaff) return;
  const existing = asList((await s.call(s.cfg.ujuzi, 'GET', '/api/courses', { token: anyStaff })).body);
  for (const course of NEW_COURSES) {
    if (existing.some((c) => c.title === course.title)) {
      s.count('Ujuzi · courses', 'existed');
      continue;
    }
    const token = world.staffTokens[course.staff];
    const { staff: _staff, ...body } = course;
    void _staff;
    const r = token ? await s.call(s.cfg.ujuzi, 'POST', '/api/courses', { token, body }) : { status: 0, body: undefined };
    if (r.status === 201) s.count('Ujuzi · courses', 'created');
    else s.count('Ujuzi · courses', 'failed', `${course.title}: ${message(r)}`);
  }
  world.courses = asList((await s.call(s.cfg.ujuzi, 'GET', '/api/courses', { token: anyStaff })).body);
}

async function seedUjuziGraduates(s: Seeder, world: UjuziWorld): Promise<void> {
  s.say('Ujuzi: 15 graduates, enrolments and certificates');
  for (const [first, last] of PEOPLE) {
    const email = emailOf(first, last, 'seed');
    const session = await signUpOrIn(s, s.cfg.ujuzi, 'Ujuzi · graduates', { role: 'graduate', email, password: s.cfg.password, firstName: first, lastName: last });
    if (session) world.graduateTokens.push({ token: session.token, id: text(session.user.id), email });
  }
  // each graduate enrols in one course, going round the whole catalogue
  const courses = world.courses;
  for (const [i, grad] of world.graduateTokens.entries()) {
    const course = courses[i % Math.max(1, courses.length)];
    if (!course) break;
    const r = await s.call(s.cfg.ujuzi, 'POST', '/api/enrolments', { token: grad.token, body: { courseId: text(course.id) } });
    if (r.status === 201) s.count('Ujuzi · enrolments', 'created');
    else if (r.status === 409) s.count('Ujuzi · enrolments', 'existed');
    else s.count('Ujuzi · enrolments', 'failed', `${grad.email}: ${message(r)}`);
  }
  // the centre that runs each course issues the certificate
  for (const grad of world.graduateTokens) {
    const mine = asList((await s.call(s.cfg.ujuzi, 'GET', '/api/me/enrolments', { token: grad.token })).body);
    for (const enrolment of mine) {
      if (enrolment.certificateNo) {
        world.certificateNumbers.push(text(enrolment.certificateNo));
        s.count('Ujuzi · certificates', 'existed');
        continue;
      }
      const course = courses.find((c) => c.id === enrolment.courseId);
      const centre = course && isObject(course.centre) ? text(course.centre.id) : '';
      const token = world.centreStaff[centre];
      if (!token) {
        s.count('Ujuzi · certificates', 'failed', `no staff login for the centre of ${text(enrolment.courseId)}`);
        continue;
      }
      const r = await s.call(s.cfg.ujuzi, 'POST', '/api/certificates', { token, body: { enrolmentId: text(enrolment.id) } });
      if (r.status === 201 && isObject(r.body)) {
        world.certificateNumbers.push(text(r.body.certificateNo));
        s.count('Ujuzi · certificates', 'created');
      } else s.count('Ujuzi · certificates', 'failed', `${text(enrolment.id)}: ${message(r)}`);
    }
  }
}

// ---- Kazi Connect: jobs, students, applications ----------------------------------------------------
const JOBS: Array<[string, string, string, string, string, number, number, boolean]> = [
  ['Event waiter, weekend weddings', 'catering', 'Nairobi', 'Westlands', 'Weekends, 3 months', 1200, 1800, true],
  ['Security guard, concert nights', 'security', 'Mombasa', 'Nyali', 'Per event, 1 night', 1800, 2200, true],
  ['Venue cleaner, conference centre', 'cleaning', 'Nairobi', 'Kilimani', 'Part time, 2 months', 900, 1300, false],
  ['Registration usher, trade fairs', 'events', 'Nairobi', 'Westlands', 'Per event, 1 day', 1200, 1600, false],
  ['AV and sound assistant', 'electrical', 'Nairobi', 'Parklands', 'Part time, 3 months', 1800, 2600, false],
  ['Hotel housekeeping assistant', 'accommodation', 'Mombasa', 'Bamburi', 'Full time, 6 months', 14000, 18000, false],
  ['Campus orientation helper', 'campus', 'Nairobi', 'South B', 'Two weeks, January intake', 800, 1200, false],
  ['Maths and science tutor, Forms 1 to 4', 'tutoring', 'Kiambu', 'Ruaka', 'Part time, 3 months', 1500, 2500, false],
  ['Plumbing assistant for event venues', 'plumbing', 'Nakuru', 'Milimani', 'Per job, 1 day', 1500, 2200, false],
  ['Bartender, private functions', 'catering', 'Kisumu', 'Milimani', 'Weekends, 2 months', 1500, 2200, false],
  ['Stage crew, gospel festival', 'events', 'Nairobi', 'Kasarani', 'One day, 27 March', 1300, 1800, true],
  ['Waiter, beach resort', 'catering', 'Kilifi', 'Malindi', 'Seasonal, 4 months', 1000, 1500, false],
  ['Night security, wedding venues', 'security', 'Nairobi', 'Karen', 'Per event, 1 night', 1800, 2300, false],
  ['Event cleaner, stadium', 'cleaning', 'Nairobi', 'Kasarani', 'Per event, 1 day', 1000, 1400, false],
  ['Campus residence assistant', 'accommodation', 'Nairobi', 'Parklands', 'Part time, 4 months', 12000, 16000, false],
];

interface KaziWorld {
  employerToken: string;
  jobIds: string[];
}

async function seedKaziJobs(s: Seeder, world: KaziWorld): Promise<void> {
  s.say('Kazi Connect: employer logs in, 15 jobs');
  const login = await s.kazi('POST', '/api/auth/login', { body: { email: s.cfg.employerEmail, password: s.cfg.employerPassword } });
  const token = isObject(login.body) ? text(login.body.token) : '';
  if (login.status !== 200 || !token) {
    s.count('Kazi · jobs', 'failed', `the employer could not log in: ${message(login)}`);
    return;
  }
  world.employerToken = token;
  // the employer's own list, because a job closes once an applicant is accepted and then leaves the active list
  const known = asList((await s.kazi('GET', '/api/me/jobs', { token })).body);
  for (const [title, category, county, area, duration, min, max, urgent] of JOBS) {
    const found = known.find((j) => j.title === title);
    if (found) {
      world.jobIds.push(text(found.id));
      s.count('Kazi · jobs', 'existed');
      continue;
    }
    const r = await s.kazi('POST', '/api/jobs', { token, body: { title, category, county, area, duration, urgent, payRange: { min, max } } });
    if (r.status === 201 && isObject(r.body)) {
      world.jobIds.push(text(r.body.id));
      s.count('Kazi · jobs', 'created');
    } else s.count('Kazi · jobs', 'failed', `${title}: ${message(r)}`);
  }
}

async function seedKaziStudents(s: Seeder): Promise<void> {
  s.say('Kazi Connect: 15 student accounts');
  for (const [first, last] of PEOPLE) {
    await signUpOrIn(s, s.cfg.kazi, 'Kazi · students', { name: `${first} ${last}`, email: emailOf(first, last, 'student'), password: s.cfg.password, role: 'student' }, s.cfg.kaziKey);
  }
}

/** Graduates apply to the jobs through Ujuzi (the real route); the employer then accepts three. */
async function seedApplications(s: Seeder, ujuzi: UjuziWorld, kazi: KaziWorld): Promise<void> {
  s.say('Ujuzi to Kazi Connect: 15 applications, then the employer accepts three');
  const { jobIds } = kazi;
  if (jobIds.length === 0) return;
  for (const [i, grad] of ujuzi.graduateTokens.entries()) {
    const jobId = jobIds[i % jobIds.length];
    const already = asList((await s.call(s.cfg.ujuzi, 'GET', '/api/me/applications', { token: grad.token })).body);
    if (already.length > 0) {
      s.count('Ujuzi · applications', 'existed');
      continue;
    }
    const r = await s.call(s.cfg.ujuzi, 'POST', '/api/me/applications', {
      token: grad.token,
      body: { jobId, preferredDate: at(2027, 2, 1 + i, 9), note: `Available from the start date, ${PEOPLE[i % PEOPLE.length][0]} here.` },
    });
    if (r.status === 201) s.count('Ujuzi · applications', 'created');
    else if (r.status === 409) s.count('Ujuzi · applications', 'existed');
    else s.count('Ujuzi · applications', 'failed', `${grad.email} for ${jobId}: ${message(r)}`);
  }
  const closedAlready = asList((await s.kazi('GET', '/api/me/jobs', { token: kazi.employerToken })).body).filter((j) => JOBS.some((x) => x[0] === j.title) && j.status === 'closed').length;
  let accepted = Math.min(3, closedAlready);
  if (accepted > 0) s.count('Kazi · applications accepted', 'existed');
  for (const jobId of jobIds.slice(0, 6)) {
    if (accepted >= 3) break;
    const apps = asList((await s.kazi('GET', `/api/jobs/${jobId}/applications`, { token: kazi.employerToken })).body);
    const first = apps.find((a) => a.status === 'pending');
    if (!first) continue;
    const r = await s.kazi('PATCH', `/api/applications/${text(first.applicationId)}`, { token: kazi.employerToken, body: { status: 'accepted' } });
    if (r.status === 200) {
      accepted += 1;
      s.count('Kazi · applications accepted', 'created');
    } else s.count('Kazi · applications accepted', 'failed', `${text(first.applicationId)}: ${message(r)}`);
  }
}

// ---- Sherehe: organisers, events, roles, offers, crew trainings ------------------------------------
const ORGANISERS = [
  { name: 'Grace Wairimu', email: 'grace.wairimu.events@example.com' },
  { name: 'Peter Otieno', email: 'peter.otieno.events@example.com' },
  { name: 'Halima Abdi', email: 'halima.abdi.events@example.com' },
];

type RoleSpec = [title: string, category: string, headcount: number, pay: number];
const EVENTS: Array<{
  by: number; name: string; type: string; county: string; area: string; venue: string; date: [number, number, number];
  from: number; to: number; guests: number; roles: RoleSpec[]; offer: [workers: number, note: string];
}> = [
  { by: 0, name: 'Akinyi and Omondi wedding', type: 'wedding', county: 'Kisumu', area: 'Milimani', venue: 'Hippo Point Gardens', date: [2027, 1, 23], from: 11, to: 19, guests: 280, roles: [['Waiters', 'catering', 12, 1500], ['Ushers', 'events', 6, 1200], ['Security guards', 'security', 4, 1800]], offer: [6, 'Six trained waiters from the Kisumu pool'] },
  { by: 0, name: 'Karanja family wedding reception', type: 'wedding', county: 'Nairobi', area: 'Karen', venue: 'Karen Country Lodge', date: [2027, 1, 30], from: 13, to: 22, guests: 220, roles: [['Waiters', 'catering', 10, 1600], ['Cleaners', 'cleaning', 4, 1100]], offer: [5, 'Five waiters with food hygiene certificates'] },
  { by: 0, name: 'Nairobi Fintech Summit 2027', type: 'conference', county: 'Nairobi', area: 'Westlands', venue: 'Sarit Expo Centre', date: [2027, 2, 10], from: 8, to: 18, guests: 600, roles: [['Registration ushers', 'events', 10, 1400], ['AV technicians', 'electrical', 3, 2500], ['Security guards', 'security', 6, 1800]], offer: [4, 'Four ushers who have worked trade fairs'] },
  { by: 0, name: 'Mombasa Coast Music Night', type: 'concert', county: 'Mombasa', area: 'Nyali', venue: 'Nyali Beach Pavilion', date: [2027, 2, 13], from: 16, to: 23, guests: 900, roles: [['Security guards', 'security', 12, 2000], ['Stage crew', 'events', 8, 1700], ['Cleaners', 'cleaning', 6, 1100]], offer: [8, 'Eight licensed guards, grade III'] },
  { by: 0, name: 'Kisumu County Agribusiness Expo', type: 'conference', county: 'Kisumu', area: 'Milimani', venue: 'Kisumu Showground', date: [2027, 2, 24], from: 8, to: 17, guests: 450, roles: [['Ushers', 'events', 8, 1300], ['Waiters', 'catering', 6, 1400]], offer: [4, 'Four ushers from Maseno campus'] },
  { by: 1, name: 'Thika Road staff retreat', type: 'corporate', county: 'Kiambu', area: 'Ruaka', venue: 'Ruaka Garden Pavilion', date: [2027, 3, 5], from: 9, to: 17, guests: 120, roles: [['Caterers', 'catering', 6, 1600], ['Cleaners', 'cleaning', 3, 1100]], offer: [3, 'Three caterers, two with barista training'] },
  { by: 1, name: 'Wambui and Kiprop wedding', type: 'wedding', county: 'Uasin Gishu', area: 'Eldoret town', venue: 'Eldoret Sports Club', date: [2027, 3, 13], from: 11, to: 19, guests: 300, roles: [['Waiters', 'catering', 14, 1500], ['Ushers', 'events', 6, 1200], ['Security guards', 'security', 4, 1800]], offer: [7, 'Seven waiters available the whole weekend'] },
  { by: 1, name: 'Nakuru annual dealers gala', type: 'corporate', county: 'Nakuru', area: 'Section 58', venue: 'Merica Hotel Ballroom', date: [2027, 3, 20], from: 17, to: 23, guests: 350, roles: [['Waiters', 'catering', 12, 1700], ['Security guards', 'security', 6, 1900]], offer: [6, 'Six waiters in black and white uniform'] },
  { by: 1, name: 'Gospel praise festival, Kasarani', type: 'concert', county: 'Nairobi', area: 'Kasarani', venue: 'Kasarani Open Grounds', date: [2027, 3, 27], from: 10, to: 20, guests: 2500, roles: [['Security guards', 'security', 20, 2000], ['Ushers', 'events', 15, 1300], ['Cleaners', 'cleaning', 8, 1100]], offer: [10, 'Ten guards for the main gate and the stage'] },
  { by: 1, name: 'Machakos tech careers fair', type: 'conference', county: 'Machakos', area: 'Machakos town', venue: 'Machakos Stadium Hall', date: [2027, 4, 8], from: 9, to: 16, guests: 400, roles: [['Ushers', 'events', 6, 1300], ['AV technicians', 'electrical', 2, 2400]], offer: [3, 'Three ushers'] },
  { by: 2, name: 'Kilifi beach party', type: 'other', county: 'Kilifi', area: 'Malindi', venue: 'Silversands Beach', date: [2027, 4, 17], from: 15, to: 23, guests: 700, roles: [['Security guards', 'security', 10, 2000], ['Bartenders', 'catering', 6, 1800], ['Cleaners', 'cleaning', 5, 1100]], offer: [5, 'Five guards, night shift ready'] },
  { by: 2, name: 'Karen charity golf dinner', type: 'corporate', county: 'Nairobi', area: 'Karen', venue: 'Karen Country Club', date: [2027, 4, 24], from: 18, to: 22, guests: 160, roles: [['Waiters', 'catering', 8, 1800], ['Ushers', 'events', 3, 1300]], offer: [4, 'Four waiters with fine-dining experience'] },
  { by: 2, name: 'Nyeri heritage wedding', type: 'wedding', county: 'Nyeri', area: 'Nyeri town', venue: 'Outspan Gardens', date: [2027, 5, 8], from: 11, to: 18, guests: 240, roles: [['Waiters', 'catering', 10, 1500], ['Cleaners', 'cleaning', 4, 1100], ['Ushers', 'events', 5, 1200]], offer: [5, 'Five waiters from Nyeri'] },
  { by: 2, name: 'Parklands jazz and food festival', type: 'concert', county: 'Nairobi', area: 'Parklands', venue: 'Parklands Open Grounds', date: [2027, 5, 15], from: 12, to: 22, guests: 1200, roles: [['Caterers', 'catering', 10, 1700], ['Security guards', 'security', 8, 1900], ['Stage crew', 'events', 6, 1700]], offer: [5, 'Five caterers who have worked food festivals'] },
  { by: 2, name: 'Kajiado county cultural day', type: 'other', county: 'Kajiado', area: 'Kitengela', venue: 'Kitengela Social Hall', date: [2027, 6, 5], from: 9, to: 18, guests: 500, roles: [['Ushers', 'events', 8, 1200], ['Waiters', 'catering', 8, 1400]], offer: [4, 'Four ushers'] },
];

async function seedSherehe(s: Seeder): Promise<void> {
  s.say('Sherehe: 3 organisers, 15 events with roles');
  const tokens: string[] = [];
  for (const o of ORGANISERS) {
    const session = await signUpOrIn(s, s.cfg.sherehe, 'Sherehe · organisers', { email: o.email, name: o.name, password: s.cfg.password });
    tokens.push(session?.token ?? '');
  }
  const probe = tokens.find(Boolean);
  if (!probe) return;
  const known = asList((await s.call(s.cfg.sherehe, 'GET', '/api/events?status=upcoming', { token: probe })).body);

  const made: Array<{ i: number; eventId: string; roleId: string; roleCategory: string; headcount: number; fresh: boolean }> = [];
  for (const [i, e] of EVENTS.entries()) {
    const token = tokens[e.by];
    if (!token) continue;
    const [y, m, d] = e.date;
    const found = known.find((k) => k.name === e.name);
    let eventId = found ? text(found.id) : '';
    if (found) s.count('Sherehe · events', 'existed');
    else {
      const r = await s.call(s.cfg.sherehe, 'POST', '/api/events', {
        token,
        body: { name: e.name, type: e.type, county: e.county, area: e.area, venue: e.venue, startsAt: at(y, m, d, e.from), endsAt: at(y, m, d, e.to), expectedGuests: e.guests },
      });
      if (r.status !== 201 || !isObject(r.body)) {
        s.count('Sherehe · events', 'failed', `${e.name}: ${message(r)}`);
        continue;
      }
      eventId = text(r.body.id);
      s.count('Sherehe · events', 'created');
    }
    let roles = asList((await s.call(s.cfg.sherehe, 'GET', `/api/events/${eventId}/roles`, { token })).body);
    if (roles.length === 0) {
      for (const [title, category, headcount, pay] of e.roles) {
        const r = await s.call(s.cfg.sherehe, 'POST', `/api/events/${eventId}/roles`, {
          token, body: { title, category, headcount, shiftStart: at(y, m, d, e.from - 2), shiftEnd: at(y, m, d, e.to + 1), payPerShift: pay },
        });
        if (r.status === 201) s.count('Sherehe · staffing roles', 'created');
        else s.count('Sherehe · staffing roles', 'failed', `${title} at ${e.name}: ${message(r)}`);
      }
      roles = asList((await s.call(s.cfg.sherehe, 'GET', `/api/events/${eventId}/roles`, { token })).body);
    } else for (let n = 0; n < roles.length; n += 1) s.count('Sherehe · staffing roles', 'existed');
    const first = roles[0];
    if (first) made.push({ i, eventId, roleId: text(first.id), roleCategory: text(first.category), headcount: Number(first.headcount), fresh: !found });
  }

  s.say('Sherehe: 15 offers from Kazi Connect, then the organisers decide');
  if (!s.cfg.partnerKey) {
    s.count('Sherehe · offers', 'failed', 'SHEREHE_PARTNER_KEY is not set, so no offers were made');
  } else {
    for (const m of made) {
      const e = EVENTS[m.i];
      const onEvent = asList((await s.call(s.cfg.sherehe, 'GET', `/api/events/${m.eventId}/offers`, { token: tokens[e.by] })).body);
      if (onEvent.some((o) => o.roleId === m.roleId)) {
        s.count('Sherehe · offers', 'existed'); // an offer of any status: a decided one must not be offered again
        continue;
      }
      const workers = Math.min(e.offer[0], m.headcount);
      const r = await s.call(s.cfg.sherehe, 'POST', '/api/offers', { key: s.cfg.partnerKey, body: { roleId: m.roleId, workersOffered: workers, note: e.offer[1] } });
      if (r.status === 201 && isObject(r.body)) {
        s.count('Sherehe · offers', 'created');
        // the first six are accepted and the next three declined; the rest stay waiting for the organiser
        const decision = m.i < 6 ? 'accepted' : m.i < 9 ? 'declined' : null;
        if (decision) {
          const d = await s.call(s.cfg.sherehe, 'PATCH', `/api/offers/${text(r.body.id)}`, { token: tokens[e.by], body: { status: decision } });
          s.count(`Sherehe · offers ${decision}`, d.status === 200 ? 'created' : 'failed', `${e.name}: ${message(d)}`);
        }
      } else if (r.status === 409) s.count('Sherehe · offers', 'existed');
      else s.count('Sherehe · offers', 'failed', `${e.name}: ${message(r)}`);
    }
  }

  s.say('Sherehe: 10 crew trainings booked at Ujuzi');
  const catalog = asList((await s.call(s.cfg.sherehe, 'GET', '/api/training-options', { token: probe })).body);
  for (const m of made.slice(0, 10)) {
    const e = EVENTS[m.i];
    const course = catalog.find((c) => c.category === m.roleCategory) ?? catalog[m.i % Math.max(1, catalog.length)];
    if (!course) {
      s.count('Sherehe · crew trainings', 'failed', 'Ujuzi gave no courses');
      continue;
    }
    const [y, mo, d] = e.date;
    const r = await s.call(s.cfg.sherehe, 'POST', '/api/crew-trainings', {
      token: tokens[e.by], body: { eventId: m.eventId, courseId: text(course.courseId), crewSize: [6, 8, 4, 10, 5, 4, 8, 6, 10, 3][m.i], preferredStart: at(y, mo, Math.max(1, d - 14), 8) },
    });
    if (r.status === 201) s.count('Sherehe · crew trainings', 'created');
    else if (r.status === 409) s.count('Sherehe · crew trainings', 'existed');
    else s.count('Sherehe · crew trainings', 'failed', `${e.name}: ${message(r)}`);
  }
}

// ---- counting what each system now holds, through its own API --------------------------------------
async function countAll(s: Seeder, ujuzi: UjuziWorld | null): Promise<Array<[string, string, number]>> {
  const rows: Array<[string, string, number]> = [];
  const organiser = await s.call(s.cfg.sherehe, 'POST', '/api/auth/login', { body: { email: ORGANISERS[0].email, password: s.cfg.password } });
  const sToken = isObject(organiser.body) ? text(organiser.body.token) : '';
  if (sToken) {
    const events = asList((await s.call(s.cfg.sherehe, 'GET', '/api/events?status=upcoming', { token: sToken })).body);
    rows.push(['Sherehe', 'upcoming events (GET /api/events)', events.length]);
    const withRoles = asList((await s.call(s.cfg.sherehe, 'GET', '/api/events?status=upcoming&include=roles', { token: sToken })).body);
    rows.push(['Sherehe', 'staffing roles on them (include=roles)', withRoles.reduce((n, e) => n + (Array.isArray(e.roles) ? e.roles.length : 0), 0)]);
    // offers are visible only to an event's own organiser, so log each organiser in once
    const tokenOf: { [by: number]: string } = {};
    let offers = 0;
    for (const e of withRoles) {
      const own = EVENTS.find((x) => x.name === e.name);
      if (!own) continue;
      if (tokenOf[own.by] === undefined) {
        const login = await s.call(s.cfg.sherehe, 'POST', '/api/auth/login', { body: { email: ORGANISERS[own.by].email, password: s.cfg.password } });
        tokenOf[own.by] = isObject(login.body) ? text(login.body.token) : '';
      }
      if (tokenOf[own.by]) offers += asList((await s.call(s.cfg.sherehe, 'GET', `/api/events/${text(e.id)}/offers`, { token: tokenOf[own.by] })).body).length;
    }
    rows.push(['Sherehe', 'offers on the seeded events', offers]);
    let trainings = 0;
    for (const o of ORGANISERS) {
      const login = await s.call(s.cfg.sherehe, 'POST', '/api/auth/login', { body: { email: o.email, password: s.cfg.password } });
      const tok = isObject(login.body) ? text(login.body.token) : '';
      if (tok) trainings += asList((await s.call(s.cfg.sherehe, 'GET', '/api/crew-trainings', { token: tok })).body).length;
    }
    rows.push(['Sherehe', 'crew trainings of the three organisers', trainings]);
  }
  const kJobs = await s.kazi('GET', '/api/jobs?status=active');
  rows.push(['Kazi Connect', 'active jobs (GET /api/jobs)', asList(kJobs.body).length]);
  const empl = await s.kazi('POST', '/api/auth/login', { body: { email: s.cfg.employerEmail, password: s.cfg.employerPassword } });
  const eTok = isObject(empl.body) ? text(empl.body.token) : '';
  if (eTok) {
    // the employer's own list includes jobs that closed when an applicant was accepted
    const mine = asList((await s.kazi('GET', '/api/me/jobs', { token: eTok })).body).filter((j) => JOBS.some((x) => x[0] === j.title));
    rows.push(['Kazi Connect', 'seeded jobs, open or closed (GET /api/me/jobs)', mine.length]);
    let apps = 0;
    for (const j of mine) apps += asList((await s.kazi('GET', `/api/jobs/${text(j.id)}/applications`, { token: eTok })).body).length;
    rows.push(['Kazi Connect', 'applications on them', apps]);
  }
  const staff = await s.call(s.cfg.ujuzi, 'POST', '/api/auth/login', { body: { email: STAFF[0].email, password: s.cfg.staffPassword } });
  const uTok = isObject(staff.body) ? text(staff.body.token) : '';
  if (uTok) {
    rows.push(['Ujuzi', 'courses (GET /api/courses)', asList((await s.call(s.cfg.ujuzi, 'GET', '/api/courses', { token: uTok })).body).length]);
    if (ujuzi) {
      let enrolments = 0;
      for (const g of ujuzi.graduateTokens) enrolments += asList((await s.call(s.cfg.ujuzi, 'GET', '/api/me/enrolments', { token: g.token })).body).length;
      rows.push(['Ujuzi', 'enrolments of the seeded graduates', enrolments]);
      rows.push(['Ujuzi', 'certificates issued to them', new Set(ujuzi.certificateNumbers).size]);
      rows.push(['Ujuzi', 'graduate accounts', ujuzi.graduateTokens.length]);
    }
  }
  return rows;
}

export async function main(argv: string[]): Promise<number> {
  loadEnvConfig(process.cwd());
  const e = process.env;
  const url = (name: string, fallback: string) => (e[name] ?? fallback).replace(/\/+$/, '');
  const cfg: Config = {
    sherehe: url('SHEREHE_URL', 'http://localhost:4001'),
    kazi: url('KAZI_URL', 'http://localhost:4002'),
    ujuzi: url('UJUZI_URL', 'http://localhost:4003'),
    partnerKey: e.SHEREHE_PARTNER_KEY || undefined,
    kaziKey: e.KAZI_API_KEY || undefined,
    employerEmail: e.KAZI_EMPLOYER_EMAIL ?? 'employer@kaziconnect.demo',
    employerPassword: e.KAZI_EMPLOYER_PASSWORD ?? 'KaziDemo2026',
    staffPassword: e.UJUZI_STAFF_PASSWORD ?? 'ujuzi-demo-pass',
    password: e.SEED_PASSWORD ?? 'Sherehe-seed-2026',
  };
  const only = argv.find((a) => a.startsWith('--only='))?.slice(7);
  const checkOnly = argv.includes('--check');
  const s = new Seeder(cfg);
  const ujuzi: UjuziWorld = { staffTokens: {}, centreStaff: {}, graduateTokens: [], courses: [], certificateNumbers: [] };
  const kazi: KaziWorld = { employerToken: '', jobIds: [] };
  const want = (name: string) => !only || only === name;

  if (!checkOnly) {
    if (want('ujuzi')) {
      await seedUjuziCourses(s, ujuzi);
      await seedUjuziGraduates(s, ujuzi);
    }
    if (want('kazi')) {
      await seedKaziJobs(s, kazi);
      await seedKaziStudents(s);
    }
    if (want('ujuzi') && want('kazi')) await seedApplications(s, ujuzi, kazi);
    if (want('sherehe')) await seedSherehe(s);
  }

  s.say('\nWhat each step did');
  for (const [label, t] of Object.entries(s.tally)) s.say(`  ${label.padEnd(34)} created ${String(t.created).padStart(3)}   already there ${String(t.existed).padStart(3)}   failed ${t.failed}`);
  s.say('\nWhat each API holds now (counted with GET requests)');
  const rows = await countAll(s, ujuzi.graduateTokens.length > 0 ? ujuzi : null);
  for (const [system, what, n] of rows) s.say(`  ${system.padEnd(13)} ${what.padEnd(44)} ${String(n).padStart(4)}`);
  if (s.problems.length > 0) {
    s.say('\nProblems');
    for (const p of s.problems.slice(0, 25)) s.say(`  - ${p}`);
  }
  return s.problems.length === 0 ? 0 : 1;
}

if (/seedRing\.ts$/.test(process.argv[1] ?? '')) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    });
}
