/**
 * Partner tests: Sherehe's checks of Ujuzi's API, written from Ujuzi's contract alone
 * (partner-tests/ujuzi_openapi.yaml, the frozen copy of what Ujuzi handed off) and run against
 * Ujuzi's live server. Nothing here imports Sherehe's own client or mappers: if the client has a
 * misunderstanding of the contract, these tests must not share it.
 *
 *   UJUZI_URL=https://<ujuzi>.onrender.com UJUZI_API_KEY=... npm run test:partner
 *   (UJUZI_API_URL works too: it is the name the rest of Sherehe uses.)
 *
 * READS always run. The tests that create, change and cancel bookings write into Ujuzi's real
 * system, so they only run with PARTNER_TESTS_WRITE=true, and they clean up after themselves.
 * Without a URL everything is skipped.
 *
 * Every failure goes into PARTNER_TEST_RESULTS.md, classified by the team as a real bug in
 * Ujuzi, a contract ambiguity, or a misunderstanding on our side. This file never decides that.
 */
import fs from 'node:fs';
import path from 'node:path';
import Ajv from 'ajv';
import { parse as parseYaml } from 'yaml';

const BASE = (process.env.UJUZI_URL || process.env.UJUZI_API_URL || '').trim().replace(/\/+$/, '');
const KEY = process.env.UJUZI_API_KEY?.trim();
const WRITES = process.env.PARTNER_TESTS_WRITE === 'true';
const CONTRACT = path.join(process.cwd(), 'partner-tests', 'ujuzi_openapi.yaml');

jest.setTimeout(90_000); // a sleeping Render service can take a minute to wake

// ---- the contract -------------------------------------------------------------------------------

type Json = { [key: string]: unknown };
interface Operation {
  responses: { [status: string]: { content?: { 'application/json'?: { schema?: Json } } } };
}
interface Contract {
  paths: { [path: string]: { [method: string]: Operation } };
  components: { schemas: { [name: string]: Json } };
}

let contract: Contract;

/** Reads the contract and replaces every local $ref ("#/components/...") with what it points at. */
function loadContract(file: string): Contract {
  const root = parseYaml(fs.readFileSync(file, 'utf8')) as Json;
  const lookup = (ref: string): unknown =>
    ref.replace(/^#\//, '').split('/').reduce<unknown>((node, key) => (node as Json | undefined)?.[key], root);
  const resolve = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(resolve);
    if (typeof node !== 'object' || node === null) return node;
    const object = node as Json;
    if (typeof object.$ref === 'string') {
      const target = lookup(object.$ref);
      if (target === undefined) throw new Error(`The contract points at ${object.$ref}, which is not in it`);
      return resolve(target);
    }
    return Object.fromEntries(Object.entries(object).map(([key, value]) => [key, resolve(value)]));
  };
  return resolve(root) as Contract;
}

const ajv = new Ajv({ strict: false, allErrors: true });
// The three systems agree to write dates as ISO 8601 UTC with a Z and no milliseconds.
ajv.addFormat('date-time', { type: 'string', validate: (v: string) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(v) && !Number.isNaN(Date.parse(v)) });
ajv.addFormat('date', { type: 'string', validate: (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) });

/** Why a value does not fit the contract's schema, or undefined if it fits. */
function misfit(schema: Json | undefined, value: unknown): string | undefined {
  if (!schema) return 'the contract documents no JSON body here';
  const validate = ajv.compile(schema);
  return validate(value) ? undefined : ajv.errorsText(validate.errors);
}
const responseSchema = (route: string, method: string, status: number): Json | undefined =>
  contract.paths[route]?.[method]?.responses?.[String(status)]?.content?.['application/json']?.schema;
const schema = (name: string): Json => contract.components.schemas[name];

// ---- talking to Ujuzi ---------------------------------------------------------------------------

interface Reply {
  status: number;
  headers: Headers;
  body: unknown;
  text: string;
}

async function call(method: string, route: string, opts: { body?: unknown; raw?: string; key?: boolean } = {}): Promise<Reply> {
  const headers: { [name: string]: string } = { Accept: 'application/json' };
  if (KEY && opts.key !== false) headers['X-API-Key'] = KEY;
  let payload: string | undefined = opts.raw;
  if (payload === undefined && opts.body !== undefined) payload = JSON.stringify(opts.body);
  if (payload !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + route, { method, headers, body: payload, redirect: 'manual', signal: AbortSignal.timeout(60_000) });
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  return { status: res.status, headers: res.headers, body, text };
}

/** The status must be one the contract documents for this operation, and the body must fit its schema. */
function expectDocumented(reply: Reply, route: string, method: string, expectedStatus: number): void {
  expect(reply.status).toBe(expectedStatus);
  if (expectedStatus === 204) {
    expect(reply.text).toBe('');
    return;
  }
  expect(reply.headers.get('content-type') ?? '').toContain('application/json');
  expect(misfit(responseSchema(route, method, expectedStatus), reply.body)).toBeUndefined();
}

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().replace(/\.\d{3}Z$/, 'Z');

// ---- the tests ----------------------------------------------------------------------------------

const suite = BASE ? describe : describe.skip;

suite(`Ujuzi partner tests (${BASE || 'no UJUZI_URL set: skipped'})`, () => {
  let courses: Array<{ id: string; category: string; county: string }> = [];

  beforeAll(async () => {
    contract = loadContract(CONTRACT);
    const list = await call('GET', '/api/courses');
    if (list.status === 200 && Array.isArray(list.body)) courses = list.body as typeof courses;
  });

  describe('S1: GET /api/courses', () => {
    it('answers 200 with a JSON array of courses that fit the contract', async () => {
      const res = await call('GET', '/api/courses');
      expectDocumented(res, '/api/courses', 'get', 200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('has at least one course to build tests on (otherwise the filter tests below say so)', () => {
      expect(courses.length).toBeGreaterThan(0);
    });

    it('filters by category: every course returned has that category', async () => {
      if (!courses[0]) return;
      const category = courses[0].category;
      const res = await call('GET', `/api/courses?category=${encodeURIComponent(category)}`);
      expectDocumented(res, '/api/courses', 'get', 200);
      const items = res.body as Array<{ category: string }>;
      expect(items.length).toBeGreaterThan(0);
      expect(items.every((c) => c.category === category)).toBe(true);
    });

    it('filters by county, ignoring letter case', async () => {
      if (!courses[0]) return;
      const county = courses[0].county;
      const [lower, upper] = await Promise.all(
        [county.toLowerCase(), county.toUpperCase()].map((c) => call('GET', `/api/courses?county=${encodeURIComponent(c)}`)),
      );
      expectDocumented(lower, '/api/courses', 'get', 200);
      expect((lower.body as Array<{ county: string }>).every((c) => c.county === county)).toBe(true);
      expect(upper.body).toEqual(lower.body);
    });

    it('answers 200 with [] when nothing matches, not an error', async () => {
      const res = await call('GET', '/api/courses?category=plumbing&county=Lamu');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('answers 400 { message } for a category outside the shared list', async () => {
      const res = await call('GET', '/api/courses?category=baking');
      expectDocumented(res, '/api/courses', 'get', 400);
    });

    it('answers 401 { message } without a key, once Ujuzi enforces keys (Week 9); open before that', async () => {
      const res = await call('GET', '/api/courses', { key: false });
      expect([200, 401]).toContain(res.status);
      if (res.status === 401) expectDocumented(res, '/api/courses', 'get', 401);
    });
  });

  describe('S1: GET /api/courses/{courseId}', () => {
    it('returns the same course the list shows', async () => {
      if (!courses[0]) return;
      const res = await call('GET', `/api/courses/${encodeURIComponent(courses[0].id)}`);
      expectDocumented(res, '/api/courses/{courseId}', 'get', 200);
      const fromList = ((await call('GET', '/api/courses')).body as Array<{ id: string }>).find((c) => c.id === courses[0].id);
      expect(res.body).toEqual(fromList);
    });

    it('answers 404 { message } for an unknown course', async () => {
      const res = await call('GET', '/api/courses/crs_999999999');
      expectDocumented(res, '/api/courses/{courseId}', 'get', 404);
    });
  });

  describe('S2: GET /api/certificates/{certificateNo}', () => {
    it('answers 400 { message } for a number that is not UJZ-YYYY-NNNNN', async () => {
      for (const bad of ['ABC', 'UJZ-2026-123', 'ujz-2026-00123x']) {
        const res = await call('GET', `/api/certificates/${encodeURIComponent(bad)}`);
        expectDocumented(res, '/api/certificates/{certificateNo}', 'get', 400);
      }
    });

    it('answers 404 { message } for a well-formed number that does not exist', async () => {
      const res = await call('GET', '/api/certificates/UJZ-1999-00000');
      expectDocumented(res, '/api/certificates/{certificateNo}', 'get', 404);
    });

    it('the contract’s own example number answers either a certificate that fits the contract, or 404', async () => {
      const res = await call('GET', '/api/certificates/UJZ-2026-00123');
      expect([200, 404]).toContain(res.status);
      expectDocumented(res, '/api/certificates/{certificateNo}', 'get', res.status);
      if (res.status === 200) {
        const cert = res.body as { certificateNo: string; holder: string };
        expect(cert.certificateNo).toBe('UJZ-2026-00123');
        expect(cert.holder).toMatch(/^\S+ [A-Z]\.$/); // "First name and initial only"
      }
    });
  });

  const writes = WRITES ? describe : describe.skip;
  writes('S3, S4, S5: bookings (these write into Ujuzi: PARTNER_TESTS_WRITE=true)', () => {
    const made: string[] = [];
    // Ujuzi's contract (0.1.1 onwards) makes a second pending booking with the same course and event
    // name a 409, so every booking these tests make gets its own name.
    const NAME = 'Sherehe partner test (safe to delete)';
    const run = Date.now().toString(36);
    let counter = 0;
    const newBooking = (change: Json = {}) => ({
      courseId: courses[0]?.id ?? 'crs_501', crewSize: 6, preferredStart: inDays(30), eventName: `${NAME} ${run}-${++counter}`, ...change,
    });
    const create = async (change: Json = {}) => {
      const res = await call('POST', '/api/bookings', { body: newBooking(change) });
      if (res.status === 201) made.push((res.body as { id: string }).id);
      return res;
    };
    afterAll(async () => {
      for (const id of made) await call('DELETE', `/api/bookings/${encodeURIComponent(id)}`).catch(() => undefined);
    });

    it('S3 creates a pending booking: 201, a Location header, and a body that fits the contract', async () => {
      const res = await create();
      expectDocumented(res, '/api/bookings', 'post', 201);
      const booking = res.body as { id: string; status: string; crewSize: number; courseId: string; eventName: string };
      expect(booking).toMatchObject({ status: 'pending', crewSize: 6, courseId: newBooking().courseId });
      expect(booking.eventName.startsWith(NAME)).toBe(true);
      expect(res.headers.get('location')).toBe(`/api/bookings/${booking.id}`);
    });

    it.each([
      ['a crew of 0', { crewSize: 0 }],
      ['a crew of 41', { crewSize: 41 }],
      ['a fractional crew', { crewSize: 2.5 }],
      ['a start in the past', { preferredStart: inDays(-3) }],
      ['a start that is not a date', { preferredStart: 'next week' }],
      ['an event name over 120 characters', { eventName: 'x'.repeat(121) }],
      ['no event name', { eventName: undefined }],
      ['a field the contract does not have', { status: 'confirmed' }],
    ])('S3 answers 400 { message } for %s, and creates nothing', async (_label, change) => {
      const before = made.length;
      const res = await create(change);
      expectDocumented(res, '/api/bookings', 'post', 400);
      expect(made.length).toBe(before);
    });

    it('S3 answers 409 { message } for a second pending booking of the same course and event name, ignoring case', async () => {
      const first = await create();
      expectDocumented(first, '/api/bookings', 'post', 201);
      const { eventName } = first.body as { eventName: string };
      const again = await create({ eventName: eventName.toUpperCase() });
      expectDocumented(again, '/api/bookings', 'post', 409);
    });

    it('S3 answers 400 for a body that is not JSON', async () => {
      expectDocumented(await call('POST', '/api/bookings', { raw: '{"courseId":' }), '/api/bookings', 'post', 400);
    });

    it('S3 answers 404 { message } for a course that does not exist', async () => {
      expectDocumented(await create({ courseId: 'crs_999999999' }), '/api/bookings', 'post', 404);
    });

    it('S4 reads a booking back exactly as created, and answers 404 for an unknown one', async () => {
      const created = (await create()).body as { id: string };
      const read = await call('GET', `/api/bookings/${created.id}`);
      expectDocumented(read, '/api/bookings/{bookingId}', 'get', 200);
      expect(read.body).toEqual(created);
      expectDocumented(await call('GET', '/api/bookings/bkg_999999999'), '/api/bookings/{bookingId}', 'get', 404);
    });

    it('S5 PUT replaces crew size and start, and sending the same body twice gives the same result', async () => {
      const created = (await create()).body as { id: string };
      const change = { crewSize: 9, preferredStart: inDays(35) };
      const once = await call('PUT', `/api/bookings/${created.id}`, { body: change });
      const twice = await call('PUT', `/api/bookings/${created.id}`, { body: change });
      expectDocumented(once, '/api/bookings/{bookingId}', 'put', 200);
      expect(twice.status).toBe(200);
      expect(twice.body).toEqual(once.body);
      expect(once.body).toMatchObject({ id: created.id, crewSize: 9, preferredStart: change.preferredStart, status: 'pending' });
      expect((await call('GET', `/api/bookings/${created.id}`)).body).toEqual(once.body);
    });

    it.each([
      ['a crew of 0', { crewSize: 0, preferredStart: inDays(35) }],
      ['a start in the past', { crewSize: 5, preferredStart: inDays(-3) }],
      ['no crewSize', { preferredStart: inDays(35) }],
      ['an extra field', { crewSize: 5, preferredStart: inDays(35), courseId: 'crs_502' }],
    ])('S5 PUT answers 400 { message } for %s, and changes nothing', async (_label, body) => {
      const created = (await create()).body as { id: string };
      expectDocumented(await call('PUT', `/api/bookings/${created.id}`, { body }), '/api/bookings/{bookingId}', 'put', 400);
      expect((await call('GET', `/api/bookings/${created.id}`)).body).toEqual(created);
    });

    it('S5 PUT answers 404 for an unknown booking', async () => {
      const res = await call('PUT', '/api/bookings/bkg_999999999', { body: { crewSize: 5, preferredStart: inDays(35) } });
      expectDocumented(res, '/api/bookings/{bookingId}', 'put', 404);
    });

    it('S5 DELETE cancels a pending booking: 204, no body, and it no longer exists', async () => {
      const created = (await create()).body as { id: string };
      expectDocumented(await call('DELETE', `/api/bookings/${created.id}`), '/api/bookings/{bookingId}', 'delete', 204);
      expectDocumented(await call('GET', `/api/bookings/${created.id}`), '/api/bookings/{bookingId}', 'get', 404);
      expectDocumented(await call('DELETE', `/api/bookings/${created.id}`), '/api/bookings/{bookingId}', 'delete', 404);
    });

    // The 409 cases (changing or cancelling a booking the centre has already decided) need a
    // booking in a decided state. Only the training centre's staff can make one (PATCH with a staff
    // token), which Sherehe does not have. Cover them by hand in the interview or with Ujuzi's team.
    it.todo('S5 409 when the booking has already been confirmed or declined (needs a decided booking from Ujuzi)');
  });

  it('the contract itself still describes every endpoint these tests use', () => {
    for (const [route, methods] of [
      ['/api/courses', ['get']], ['/api/courses/{courseId}', ['get']], ['/api/certificates/{certificateNo}', ['get']],
      ['/api/bookings', ['post']], ['/api/bookings/{bookingId}', ['get', 'put', 'delete']],
    ] as const) {
      for (const method of methods) expect(contract.paths[route]?.[method]).toBeDefined();
    }
    expect(schema('Booking')).toBeDefined();
  });
});
