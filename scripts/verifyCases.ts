/**
 * The requests `npm run verify` sends, in the order it sends them. Later cases use tokens and ids
 * that earlier ones captured, so the order matters: accounts first, then what they create.
 *
 * To cover a new endpoint, add cases here. Each one names the operation exactly as openapi.yaml
 * writes it, the status to expect and any rules specific to that case; scripts/verifyContract.ts
 * does the schema checking.
 */
import type { Store } from '@/lib/db/types';

export type JsonObject = { [key: string]: unknown };
export const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Values captured from earlier responses (tokens, ids) for later cases to use. */
export type Ctx = { [key: string]: string };

/** What a case's follow-up checks can use. */
export interface Env {
  ctx: Ctx;
  store: Store;
  /** A GET against the running server, optionally as a logged-in organiser. */
  get: (path: string, token?: string) => Promise<{ status: number; body: unknown }>;
}

export interface Case {
  /** The operation as the contract writes it, e.g. "GET /api/events/{eventId}". */
  operation: string;
  label: string;
  /** Path and query actually requested. */
  url: string | ((ctx: Ctx) => string);
  /** JSON body to send, or a function building it from captured values. */
  body?: unknown;
  /** Raw text to send instead of a body, for malformed JSON. */
  rawBody?: string;
  headers?: (ctx: Ctx) => { [name: string]: string };
  expectStatus: number;
  /** Response headers that must be present, as exact text or a pattern. */
  expectHeaders?: { [name: string]: string | RegExp };
  /** Extra checks on the parsed body; return a problem description, or undefined when fine. */
  check?: (body: unknown, ctx: Ctx) => string | undefined;
  /** Remember something from the response for later cases. */
  capture?: (body: unknown, ctx: Ctx) => void;
  /** Follow-up checks after the response, e.g. re-fetching what a write created. Return problems. */
  after?: (env: Env, body: unknown) => Promise<string[]>;
  /** Stored data must be exactly as it was before the request (every read, every rejected write). */
  unchanged?: boolean;
}

// ---- small helpers for writing cases ---------------------------------------------------------

/** A value captured by an earlier case. Throws a readable error if that case did not run or failed. */
export const need = (ctx: Ctx, key: string): string => {
  const value = ctx[key];
  if (value === undefined) throw new Error(`this case needs "${key}" from an earlier case, which did not capture it`);
  return value;
};

const asArray = (body: unknown): JsonObject[] => (Array.isArray(body) ? body.filter(isObject) : []);

const as = (tokenKey: string) => (ctx: Ctx) => ({ Authorization: `Bearer ${need(ctx, tokenKey)}` });

const allHave = (field: string, expected: string) => (body: unknown) => {
  const bad = asArray(body).filter((item) => item[field] !== expected);
  return bad.length ? `${bad.length} item(s) with ${field} other than ${expected}` : undefined;
};
const sortedBy = (field: string) => (body: unknown) => {
  const values = asArray(body).map((item) => String(item[field]));
  return values.join() === [...values].sort().join() ? undefined : `not sorted by ${field}`;
};
const includes = (id: string) => (body: unknown) =>
  asArray(body).some((item) => item.id === id) ? undefined : `${id} is missing`;
const excludes = (id: string) => (body: unknown) =>
  asArray(body).some((item) => item.id === id) ? `${id} should not be listed` : undefined;
const isEmptyArray = (body: unknown) => (Array.isArray(body) && body.length === 0 ? undefined : 'expected []');
const messageContains = (text: string) => (body: unknown) =>
  isObject(body) && typeof body.message === 'string' && body.message.includes(text)
    ? undefined
    : `message does not mention "${text}"`;
const hasId = (id: string) => (body: unknown) => (isObject(body) && body.id === id ? undefined : `id is not ${id}`);
const field = (name: string, expected: unknown) => (body: unknown) =>
  isObject(body) && body[name] === expected ? undefined : `${name} is not ${JSON.stringify(expected)}`;
export const all = (...checks: Array<(body: unknown, ctx: Ctx) => string | undefined>) =>
  (body: unknown, ctx: Ctx) => checks.map((c) => c(body, ctx)).find((problem) => problem !== undefined);

// ---- the cases -------------------------------------------------------------------------------

export async function buildCases(env: Env): Promise<Case[]> {
  const { store } = env;

  // Fixtures the sample data cannot provide: an event with no roles, and a pending offer.
  const bare = await store.events.create({
    organiser_id: 'usr_1001', name: 'Verification fixture: an event with no roles yet', type: 'other',
    county: 'Kisumu', area: 'Milimani', venue: 'Fixture Hall', starts_at: new Date('2027-03-01T10:00:00Z'),
    ends_at: new Date('2027-03-01T12:00:00Z'), expected_guests: 10, status: 'upcoming',
  });
  const fixtureOffer = await store.offers.create({
    role_id: 'rol_3001', event_id: 'evt_2001', workers_offered: 6, note: 'Verification fixture offer',
  });

  const owner = { email: 'verify.owner@example.com', name: 'Verify Owner', password: 'owner password 123' };
  const stranger = { email: 'verify.stranger@example.com', name: 'Verify Stranger', password: 'stranger password 123' };
  const noUser = (email: string) => async ({ store: s }: Env) =>
    (await s.users.findByEmail(email)) ? [`an account for ${email} was created by a rejected request`] : [];

  return [
    // ---- K1: GET /api/events -----------------------------------------------------------------
    { operation: 'GET /api/events', label: 'upcoming events', url: '/api/events?status=upcoming', expectStatus: 200, unchanged: true,
      check: all(allHave('status', 'upcoming'), sortedBy('startsAt'), includes('evt_2001'), excludes('evt_2007')) },
    { operation: 'GET /api/events', label: 'county filter, lower case', url: '/api/events?status=upcoming&county=nairobi', expectStatus: 200, unchanged: true,
      check: all(allHave('county', 'Nairobi'), includes('evt_2001'), excludes('evt_2006')) },
    { operation: 'GET /api/events', label: 'county filter, upper case', url: '/api/events?status=upcoming&county=MOMBASA', expectStatus: 200, unchanged: true,
      check: all(allHave('county', 'Mombasa'), includes('evt_2006')) },
    { operation: 'GET /api/events', label: 'real county with no events', url: '/api/events?status=upcoming&county=Turkana', expectStatus: 200, unchanged: true,
      check: isEmptyArray },
    { operation: 'GET /api/events', label: 'status missing', url: '/api/events', expectStatus: 400, unchanged: true,
      check: messageContains('status is required') },
    { operation: 'GET /api/events', label: 'status not upcoming', url: '/api/events?status=completed', expectStatus: 400, unchanged: true,
      check: messageContains('status must be upcoming') },
    { operation: 'GET /api/events', label: 'county is not a county', url: '/api/events?status=upcoming&county=Narnia', expectStatus: 400, unchanged: true,
      check: messageContains('47 counties') },

    // ---- K1: GET /api/events/{eventId} -------------------------------------------------------
    { operation: 'GET /api/events/{eventId}', label: 'an upcoming event', url: '/api/events/evt_2001', expectStatus: 200, unchanged: true,
      check: hasId('evt_2001') },
    { operation: 'GET /api/events/{eventId}', label: 'an event that is over', url: '/api/events/evt_2007', expectStatus: 200, unchanged: true,
      check: field('status', 'completed') },
    { operation: 'GET /api/events/{eventId}', label: 'unknown id', url: '/api/events/evt_9999', expectStatus: 404, unchanged: true,
      check: messageContains('evt_9999') },

    // ---- K2: GET /api/events/{eventId}/roles -------------------------------------------------
    { operation: 'GET /api/events/{eventId}/roles', label: 'an event with roles', url: '/api/events/evt_2001/roles', expectStatus: 200, unchanged: true,
      check: all(
        (body) => (asArray(body).length === 2 ? undefined : 'expected 2 roles'),
        (body) => (asArray(body).every((r) => r.eventId === 'evt_2001') ? undefined : 'a role belongs to another event'),
      ) },
    { operation: 'GET /api/events/{eventId}/roles', label: 'an event with no roles', url: `/api/events/${bare.id}/roles`, expectStatus: 200, unchanged: true,
      check: isEmptyArray },
    { operation: 'GET /api/events/{eventId}/roles', label: 'unknown event', url: '/api/events/evt_9999/roles', expectStatus: 404, unchanged: true,
      check: messageContains('evt_9999') },

    // ---- K4: GET /api/offers/{offerId} -------------------------------------------------------
    { operation: 'GET /api/offers/{offerId}', label: 'a pending offer', url: `/api/offers/${fixtureOffer.id}`, expectStatus: 200, unchanged: true,
      check: all(hasId(fixtureOffer.id), field('status', 'pending')) },
    { operation: 'GET /api/offers/{offerId}', label: 'unknown id', url: '/api/offers/ofr_9999', expectStatus: 404, unchanged: true,
      check: messageContains('ofr_9999') },

    // ---- O1: accounts ------------------------------------------------------------------------
    { operation: 'POST /api/auth/register', label: 'a new organiser', url: '/api/auth/register', body: owner, expectStatus: 201,
      expectHeaders: { 'cache-control': 'no-store' },
      check: (body) => (isObject(body) && isObject(body.user) && body.user.email === owner.email ? undefined : 'user.email is not the one registered'),
      capture: (body, ctx) => {
        if (isObject(body) && isObject(body.user)) Object.assign(ctx, { ownerToken: String(body.token), ownerId: String(body.user.id) });
      },
      after: async ({ ctx, get }, body) => {
        // read back: the token works, and /api/me shows the same organiser
        const me = await get('/api/me', need(ctx, 'ownerToken'));
        return isObject(body) && JSON.stringify(me.body) === JSON.stringify(body.user) ? [] : [`GET /api/me did not return the new organiser (status ${me.status})`];
      } },
    { operation: 'POST /api/auth/register', label: 'a second organiser', url: '/api/auth/register', body: stranger, expectStatus: 201,
      capture: (body, ctx) => {
        if (isObject(body) && isObject(body.user)) Object.assign(ctx, { strangerToken: String(body.token), strangerId: String(body.user.id) });
      } },
    { operation: 'POST /api/auth/register', label: 'email already taken (other letter case)', url: '/api/auth/register',
      body: { ...owner, email: owner.email.toUpperCase(), name: 'Intruder' }, expectStatus: 409, unchanged: true,
      after: async ({ ctx, get }) => {
        const me = await get('/api/me', need(ctx, 'ownerToken'));
        return isObject(me.body) && me.body.name === owner.name ? [] : ['the existing account was changed by the rejected request'];
      } },
    { operation: 'POST /api/auth/register', label: 'email without @', url: '/api/auth/register',
      body: { ...owner, email: 'no-at-sign.example.com' }, expectStatus: 400, unchanged: true,
      check: messageContains('valid email'), after: noUser('no-at-sign.example.com') },
    { operation: 'POST /api/auth/register', label: 'password too short', url: '/api/auth/register',
      body: { email: 'short.pw@example.com', name: 'Short', password: 'short' }, expectStatus: 400, unchanged: true,
      check: messageContains('at least 8'), after: noUser('short.pw@example.com') },
    { operation: 'POST /api/auth/register', label: 'unknown field', url: '/api/auth/register',
      body: { email: 'extra.field@example.com', name: 'Extra', password: 'long enough pw', isAdmin: true }, expectStatus: 400, unchanged: true,
      check: messageContains('Unknown field "isAdmin"'), after: noUser('extra.field@example.com') },
    { operation: 'POST /api/auth/register', label: 'malformed JSON', url: '/api/auth/register', rawBody: '{"email":', expectStatus: 400, unchanged: true,
      check: messageContains('not valid JSON') },

    { operation: 'POST /api/auth/login', label: 'correct password', url: '/api/auth/login',
      body: { email: owner.email, password: owner.password }, expectStatus: 200, expectHeaders: { 'cache-control': 'no-store' },
      check: (body, ctx) => (isObject(body) && isObject(body.user) && body.user.id === need(ctx, 'ownerId') ? undefined : 'user.id is not the owner'),
      capture: (body, ctx) => {
        if (isObject(body)) ctx.loginToken = String(body.token);
      } },
    { operation: 'POST /api/auth/login', label: 'wrong password', url: '/api/auth/login',
      body: { email: owner.email, password: 'not the password' }, expectStatus: 401, unchanged: true,
      check: messageContains('Email or password is incorrect') },
    { operation: 'POST /api/auth/login', label: 'unknown email gives the same answer', url: '/api/auth/login',
      body: { email: 'nobody@example.com', password: 'not the password' }, expectStatus: 401, unchanged: true,
      check: messageContains('Email or password is incorrect') },
    { operation: 'POST /api/auth/login', label: 'password missing', url: '/api/auth/login',
      body: { email: owner.email }, expectStatus: 400, unchanged: true, check: messageContains('password is required') },

    { operation: 'GET /api/me', label: 'the logged-in organiser', url: '/api/me', headers: as('ownerToken'), expectStatus: 200, unchanged: true,
      check: (body, ctx) => (isObject(body) && body.id === need(ctx, 'ownerId') && body.name === owner.name ? undefined : 'not the owner') },
    { operation: 'GET /api/me', label: 'no token', url: '/api/me', expectStatus: 401, unchanged: true, expectHeaders: { 'www-authenticate': 'Bearer' } },
    { operation: 'GET /api/me', label: 'a token that was never issued', url: '/api/me',
      headers: () => ({ Authorization: `Bearer ${'a'.repeat(43)}` }), expectStatus: 401, unchanged: true },

    { operation: 'POST /api/auth/logout', label: 'ends that login', url: '/api/auth/logout', headers: as('loginToken'), expectStatus: 204,
      after: async ({ ctx, get }) => {
        const me = await get('/api/me', need(ctx, 'loginToken'));
        const other = await get('/api/me', need(ctx, 'ownerToken'));
        return [
          ...(me.status === 401 ? [] : [`the logged-out token still works (status ${me.status})`]),
          ...(other.status === 200 ? [] : ['logging out also ended the other login']),
        ];
      } },
    { operation: 'POST /api/auth/logout', label: 'the same token again', url: '/api/auth/logout', headers: as('loginToken'), expectStatus: 401, unchanged: true },
    { operation: 'POST /api/auth/logout', label: 'no token', url: '/api/auth/logout', expectStatus: 401, unchanged: true },
  ];
}
