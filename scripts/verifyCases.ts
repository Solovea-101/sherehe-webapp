/**
 * The requests `npm run verify` sends, in the order it sends them. Later cases use tokens and ids
 * that earlier ones captured, so the order matters: accounts first, then what they create.
 *
 * To cover a new endpoint, add cases here. Each one names the operation exactly as openapi.yaml
 * writes it, the status to expect and any rules specific to that case; scripts/verifyContract.ts
 * does the schema checking.
 */
import type { Store } from '@/lib/db/types';
import type { UjuziStub } from '../__tests__/helpers/ujuziStub';

export type JsonObject = { [key: string]: unknown };
export const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Values captured from earlier responses (tokens, ids) for later cases to use. */
export type Ctx = { [key: string]: string };

/** What a case's follow-up checks can use. */
export interface Env {
  ctx: Ctx;
  store: Store;
  /** The local stand-in for Ujuzi that the server is pointed at. */
  ujuzi: UjuziStub;
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
  /** Runs just before the request, e.g. to create a fixture that depends on captured values. */
  before?: (env: Env) => Promise<void>;
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

/** An ISO 8601 UTC time (Z, no milliseconds) n days ahead, at the given hour. */
export const inDays = (days: number, hour = 10): string => {
  const d = new Date(Date.now() + days * 86_400_000);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
};

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

  const newEvent = {
    name: 'Verification gala', type: 'wedding', county: 'nakuru', area: 'Milimani', venue: 'Verification Hall',
    startsAt: inDays(90), endsAt: inDays(90, 20), expectedGuests: 150,
  };
  const newRole = {
    title: 'Verification ushers', category: 'events', headcount: 4, shiftStart: inDays(90, 8), shiftEnd: inDays(90, 21), payPerShift: 1300,
  };
  const putBody = { crewSize: 9, preferredStart: inDays(35) };
  const eventUrl = (suffix = '') => (ctx: Ctx) => `/api/events/${need(ctx, 'eventId')}${suffix}`;

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

    // ---- O2: POST /api/events ----------------------------------------------------------------
    { operation: 'POST /api/events', label: 'an organiser creates an event', url: '/api/events', headers: as('ownerToken'), body: newEvent,
      expectStatus: 201, expectHeaders: { location: /^\/api\/events\/evt_\d+$/ },
      check: all(field('status', 'upcoming'), field('county', 'Nakuru'), field('name', newEvent.name)),
      capture: (body, ctx) => {
        if (isObject(body)) ctx.eventId = String(body.id);
      },
      after: async ({ ctx, get }, body) => {
        // read back: the event is there by id, and in the county list partners read
        const one = await get(`/api/events/${need(ctx, 'eventId')}`);
        const list = await get('/api/events?status=upcoming&county=Nakuru');
        return [
          ...(JSON.stringify(one.body) === JSON.stringify(body) ? [] : ['GET /api/events/{id} does not return what was created']),
          ...(asArray(list.body).some((e) => e.id === ctx.eventId) ? [] : ['the new event is missing from the county list']),
        ];
      } },
    { operation: 'POST /api/events', label: 'no login', url: '/api/events', body: newEvent, expectStatus: 401, unchanged: true,
      expectHeaders: { 'www-authenticate': 'Bearer' } },
    { operation: 'POST /api/events', label: 'start date in the past', url: '/api/events', headers: as('ownerToken'),
      body: { ...newEvent, startsAt: '2020-01-01T10:00:00Z' }, expectStatus: 400, unchanged: true, check: messageContains('startsAt must be in the future') },
    { operation: 'POST /api/events', label: 'county that does not exist', url: '/api/events', headers: as('ownerToken'),
      body: { ...newEvent, county: 'Narnia' }, expectStatus: 400, unchanged: true, check: messageContains('47 counties') },
    { operation: 'POST /api/events', label: 'tries to set the status', url: '/api/events', headers: as('ownerToken'),
      body: { ...newEvent, status: 'completed' }, expectStatus: 400, unchanged: true, check: messageContains('Unknown field "status"') },
    { operation: 'POST /api/events', label: 'guests sent as text', url: '/api/events', headers: as('ownerToken'),
      body: { ...newEvent, expectedGuests: '150' }, expectStatus: 400, unchanged: true, check: messageContains('expectedGuests must be a whole number') },

    // ---- O2: POST /api/events/{eventId}/roles ------------------------------------------------
    { operation: 'POST /api/events/{eventId}/roles', label: 'the organiser adds a role', url: eventUrl('/roles'), headers: as('ownerToken'),
      body: newRole, expectStatus: 201,
      check: all(field('filled', 0), field('title', newRole.title), (body, ctx) => (isObject(body) && body.eventId === ctx.eventId ? undefined : 'eventId is not the event')),
      capture: (body, ctx) => {
        if (isObject(body)) ctx.roleId = String(body.id);
      },
      after: async ({ ctx, get }, body) => {
        const roles = await get(`/api/events/${need(ctx, 'eventId')}/roles`);
        return JSON.stringify(roles.body) === JSON.stringify([body]) ? [] : ['GET .../roles does not show exactly the new role'];
      } },
    { operation: 'POST /api/events/{eventId}/roles', label: 'no login', url: eventUrl('/roles'), body: newRole, expectStatus: 401, unchanged: true },
    { operation: 'POST /api/events/{eventId}/roles', label: 'another organiser’s event', url: eventUrl('/roles'), headers: as('strangerToken'),
      body: newRole, expectStatus: 403, unchanged: true, check: messageContains('only add roles to events you created') },
    { operation: 'POST /api/events/{eventId}/roles', label: 'a sample event nobody here owns', url: '/api/events/evt_2001/roles', headers: as('ownerToken'),
      body: newRole, expectStatus: 403, unchanged: true },
    { operation: 'POST /api/events/{eventId}/roles', label: 'unknown event', url: '/api/events/evt_9999/roles', headers: as('ownerToken'),
      body: newRole, expectStatus: 404, unchanged: true, check: messageContains('evt_9999') },
    { operation: 'POST /api/events/{eventId}/roles', label: 'headcount 0', url: eventUrl('/roles'), headers: as('ownerToken'),
      body: { ...newRole, headcount: 0 }, expectStatus: 400, unchanged: true, check: messageContains('headcount must be a whole number') },
    { operation: 'POST /api/events/{eventId}/roles', label: 'tries to set filled', url: eventUrl('/roles'), headers: as('ownerToken'),
      body: { ...newRole, filled: 4 }, expectStatus: 400, unchanged: true, check: messageContains('Unknown field "filled"') },
    { operation: 'POST /api/events/{eventId}/roles', label: 'category outside the shared list', url: eventUrl('/roles'), headers: as('ownerToken'),
      body: { ...newRole, category: 'baking' }, expectStatus: 400, unchanged: true, check: messageContains('category must be one of') },
    { operation: 'POST /api/events/{eventId}/roles', label: 'event is no longer upcoming', url: (ctx) => `/api/events/${need(ctx, 'completedEventId')}/roles`,
      headers: as('ownerToken'), body: newRole, expectStatus: 409, unchanged: true, check: messageContains('roles can only be added to upcoming events'),
      before: async ({ ctx, store }) => {
        // no API finishes an event, so build the fixture in the store: the owner's, but already completed
        const done = await store.events.create({
          organiser_id: need(ctx, 'ownerId'), name: 'Verification fixture: already over', type: 'other', county: 'Nakuru',
          area: 'Milimani', venue: 'Hall', starts_at: new Date('2026-01-10T10:00:00Z'), ends_at: new Date('2026-01-10T12:00:00Z'),
          expected_guests: 10, status: 'completed',
        });
        ctx.completedEventId = done.id;
      } },

    // ---- O3: GET /api/events/{eventId}/offers ------------------------------------------------
    { operation: 'GET /api/events/{eventId}/offers', label: 'an event with no offers yet', url: eventUrl('/offers'), headers: as('ownerToken'),
      expectStatus: 200, unchanged: true, check: isEmptyArray },
    { operation: 'GET /api/events/{eventId}/offers', label: 'no login', url: eventUrl('/offers'), expectStatus: 401, unchanged: true },
    { operation: 'GET /api/events/{eventId}/offers', label: 'another organiser’s event', url: eventUrl('/offers'), headers: as('strangerToken'),
      expectStatus: 403, unchanged: true, check: messageContains('only see the offers on events you created') },
    { operation: 'GET /api/events/{eventId}/offers', label: 'unknown event', url: '/api/events/evt_9999/offers', headers: as('ownerToken'),
      expectStatus: 404, unchanged: true, check: messageContains('evt_9999') },

    // ---- K3: POST /api/offers (the owner's role has 4 places) --------------------------------
    { operation: 'POST /api/offers', label: 'Kazi offers 3 of the 4 places', url: '/api/offers',
      body: (ctx: Ctx) => ({ roleId: need(ctx, 'roleId'), workersOffered: 3, note: 'Verification offer' }),
      expectStatus: 201, expectHeaders: { location: /^\/api\/offers\/ofr_\d+$/ },
      check: all(field('status', 'pending'), field('workersOffered', 3), (body, ctx) => (isObject(body) && body.eventId === ctx.eventId ? undefined : 'eventId is not the role’s event')),
      capture: (body, ctx) => {
        if (isObject(body)) ctx.offerId = String(body.id);
      },
      after: async ({ ctx, get }, body) => {
        const one = await get(`/api/offers/${need(ctx, 'offerId')}`);
        const mine = await get(`/api/events/${need(ctx, 'eventId')}/offers`, need(ctx, 'ownerToken'));
        const roles = await get(`/api/events/${need(ctx, 'eventId')}/roles`);
        const role = asArray(roles.body).find((r) => r.id === ctx.roleId);
        return [
          ...(JSON.stringify(one.body) === JSON.stringify(body) ? [] : ['GET /api/offers/{id} does not return what was created']),
          ...(JSON.stringify(mine.body) === JSON.stringify([body]) ? [] : ['the organiser’s offer list is not exactly the new offer']),
          ...(role?.filled === 0 ? [] : ['a pending offer already filled places on the role']),
        ];
      } },
    { operation: 'POST /api/offers', label: 'a second pending offer on the same role', url: '/api/offers',
      body: (ctx: Ctx) => ({ roleId: need(ctx, 'roleId'), workersOffered: 1 }), expectStatus: 409, unchanged: true,
      check: messageContains('already has a pending offer') },
    { operation: 'POST /api/offers', label: 'unknown role', url: '/api/offers', body: { roleId: 'rol_9999', workersOffered: 1 },
      expectStatus: 404, unchanged: true, check: messageContains('Role rol_9999 not found') },
    { operation: 'POST /api/offers', label: 'a role on an event that is over', url: '/api/offers', body: { roleId: 'rol_3011', workersOffered: 1 },
      expectStatus: 409, unchanged: true, check: messageContains('only upcoming events accept offers') },
    { operation: 'POST /api/offers', label: 'a role with no places left', url: '/api/offers',
      body: (ctx: Ctx) => ({ roleId: need(ctx, 'fullRoleId'), workersOffered: 1 }), expectStatus: 409, unchanged: true,
      check: messageContains('is full'),
      before: async ({ ctx, store }) => {
        const full = await store.roles.create({
          event_id: need(ctx, 'eventId'), title: 'Verification fixture: full role', category: 'events', headcount: 2, filled: 2,
          shift_start: new Date(Date.now() + 90 * 86_400_000), shift_end: new Date(Date.now() + 91 * 86_400_000), pay_per_shift: 1000,
        });
        ctx.fullRoleId = full.id;
      } },
    { operation: 'POST /api/offers', label: 'more workers than open places', url: '/api/offers',
      body: (ctx: Ctx) => ({ roleId: need(ctx, 'roleId'), workersOffered: 5 }), expectStatus: 400, unchanged: true,
      check: messageContains('from 1 to the open slots') },
    { operation: 'POST /api/offers', label: 'zero workers', url: '/api/offers',
      body: (ctx: Ctx) => ({ roleId: need(ctx, 'roleId'), workersOffered: 0 }), expectStatus: 400, unchanged: true,
      check: messageContains('from 1 to the open slots') },
    { operation: 'POST /api/offers', label: 'workers sent as text', url: '/api/offers',
      body: (ctx: Ctx) => ({ roleId: need(ctx, 'roleId'), workersOffered: '2' }), expectStatus: 400, unchanged: true,
      check: messageContains('whole number') },
    { operation: 'POST /api/offers', label: 'tries to set the status', url: '/api/offers',
      body: (ctx: Ctx) => ({ roleId: need(ctx, 'roleId'), workersOffered: 1, status: 'accepted' }), expectStatus: 400, unchanged: true,
      check: messageContains('Unknown field "status"') },

    // ---- O3: PATCH /api/offers/{offerId} -----------------------------------------------------
    { operation: 'PATCH /api/offers/{offerId}', label: 'no login', url: (ctx) => `/api/offers/${need(ctx, 'offerId')}`,
      body: { status: 'accepted' }, expectStatus: 401, unchanged: true },
    { operation: 'PATCH /api/offers/{offerId}', label: 'another organiser', url: (ctx) => `/api/offers/${need(ctx, 'offerId')}`,
      headers: as('strangerToken'), body: { status: 'accepted' }, expectStatus: 403, unchanged: true,
      check: messageContains('only decide offers on events you created') },
    { operation: 'PATCH /api/offers/{offerId}', label: 'unknown offer', url: '/api/offers/ofr_9999', headers: as('ownerToken'),
      body: { status: 'accepted' }, expectStatus: 404, unchanged: true, check: messageContains('ofr_9999') },
    { operation: 'PATCH /api/offers/{offerId}', label: 'status pending is not a decision', url: (ctx) => `/api/offers/${need(ctx, 'offerId')}`,
      headers: as('ownerToken'), body: { status: 'pending' }, expectStatus: 400, unchanged: true, check: messageContains('accepted, declined') },
    { operation: 'PATCH /api/offers/{offerId}', label: 'the organiser accepts: 3 places fill', url: (ctx) => `/api/offers/${need(ctx, 'offerId')}`,
      headers: as('ownerToken'), body: { status: 'accepted' }, expectStatus: 200, check: field('status', 'accepted'),
      after: async ({ ctx, get }, body) => {
        const one = await get(`/api/offers/${need(ctx, 'offerId')}`);
        const roles = await get(`/api/events/${need(ctx, 'eventId')}/roles`);
        const role = asArray(roles.body).find((r) => r.id === ctx.roleId);
        return [
          ...(JSON.stringify(one.body) === JSON.stringify(body) ? [] : ['Kazi’s GET does not show the accepted offer']),
          ...(role?.filled === 3 ? [] : [`the role shows ${role?.filled} filled, expected 3`]),
        ];
      } },
    { operation: 'PATCH /api/offers/{offerId}', label: 'deciding again: decisions are final', url: (ctx) => `/api/offers/${need(ctx, 'offerId')}`,
      headers: as('ownerToken'), body: { status: 'declined' }, expectStatus: 409, unchanged: true, check: messageContains('final') },

    // ---- K5: DELETE /api/offers/{offerId} ----------------------------------------------------
    { operation: 'POST /api/offers', label: 'a new offer once the first was decided (1 place left)', url: '/api/offers',
      body: (ctx: Ctx) => ({ roleId: need(ctx, 'roleId'), workersOffered: 1 }), expectStatus: 201,
      capture: (body, ctx) => {
        if (isObject(body)) ctx.offer2Id = String(body.id);
      } },
    { operation: 'DELETE /api/offers/{offerId}', label: 'Kazi withdraws a pending offer', url: (ctx) => `/api/offers/${need(ctx, 'offer2Id')}`, expectStatus: 204,
      after: async ({ ctx, get }) => {
        const gone = await get(`/api/offers/${need(ctx, 'offer2Id')}`);
        const mine = await get(`/api/events/${need(ctx, 'eventId')}/offers`, need(ctx, 'ownerToken'));
        return [
          ...(gone.status === 404 ? [] : [`the withdrawn offer can still be read (status ${gone.status})`]),
          ...(asArray(mine.body).some((o) => o.id === ctx.offer2Id) ? ['the organiser still sees the withdrawn offer'] : []),
        ];
      } },
    { operation: 'DELETE /api/offers/{offerId}', label: 'the same offer again', url: (ctx) => `/api/offers/${need(ctx, 'offer2Id')}`, expectStatus: 404, unchanged: true },
    { operation: 'DELETE /api/offers/{offerId}', label: 'an accepted offer cannot be withdrawn', url: (ctx) => `/api/offers/${need(ctx, 'offerId')}`,
      expectStatus: 409, unchanged: true, check: messageContains('only pending offers can be withdrawn'),
      after: async ({ ctx, get }) => {
        const still = await get(`/api/offers/${need(ctx, 'offerId')}`);
        return isObject(still.body) && still.body.status === 'accepted' ? [] : ['the accepted offer changed'];
      } },
    { operation: 'DELETE /api/offers/{offerId}', label: 'unknown offer', url: '/api/offers/ofr_9999', expectStatus: 404, unchanged: true, check: messageContains('ofr_9999') },

    { operation: 'POST /api/offers', label: 'one more offer, to be declined', url: '/api/offers',
      body: (ctx: Ctx) => ({ roleId: need(ctx, 'roleId'), workersOffered: 1 }), expectStatus: 201,
      capture: (body, ctx) => {
        if (isObject(body)) ctx.offer3Id = String(body.id);
      } },
    { operation: 'PATCH /api/offers/{offerId}', label: 'the organiser declines: no places fill', url: (ctx) => `/api/offers/${need(ctx, 'offer3Id')}`,
      headers: as('ownerToken'), body: { status: 'declined' }, expectStatus: 200, check: field('status', 'declined'),
      after: async ({ ctx, get }) => {
        const roles = await get(`/api/events/${need(ctx, 'eventId')}/roles`);
        const role = asArray(roles.body).find((r) => r.id === ctx.roleId);
        return role?.filled === 3 ? [] : [`declining changed the role: ${role?.filled} filled, expected 3`];
      } },

    // ---- O4 / S1: GET /api/training-options --------------------------------------------------
    { operation: 'GET /api/training-options', label: 'every course, in our own shape', url: '/api/training-options', headers: as('ownerToken'),
      expectStatus: 200, unchanged: true,
      check: all((body) => (asArray(body).length === 4 ? undefined : 'expected 4 courses'),
        (body) => (JSON.stringify(body).includes('cen_') ? 'Ujuzi’s centre id leaked' : undefined)) },
    { operation: 'GET /api/training-options', label: 'category and county filters, any letter case', url: '/api/training-options?category=security&county=NAIROBI',
      headers: as('ownerToken'), expectStatus: 200, unchanged: true,
      check: (body) => (asArray(body).length === 1 && asArray(body)[0].courseId === 'crs_502' ? undefined : 'expected only crs_502') },
    { operation: 'GET /api/training-options', label: 'nothing matches', url: '/api/training-options?category=plumbing', headers: as('ownerToken'),
      expectStatus: 200, unchanged: true, check: isEmptyArray },
    { operation: 'GET /api/training-options', label: 'category outside the shared list', url: '/api/training-options?category=baking', headers: as('ownerToken'),
      expectStatus: 400, unchanged: true, check: messageContains('category must be one of') },
    { operation: 'GET /api/training-options', label: 'no login', url: '/api/training-options', expectStatus: 401, unchanged: true },
    { operation: 'GET /api/training-options', label: 'Ujuzi is down: our own 502', url: '/api/training-options?county=Mombasa', headers: as('ownerToken'),
      expectStatus: 502, unchanged: true, check: all(messageContains('Ujuzi is not responding right now'), (body) => (JSON.stringify(body).match(/ECONN|127\.0\.0\.1|socket/i) ? 'Ujuzi’s failure leaked' : undefined)),
      before: async ({ ujuzi }) => {
        ujuzi.mode = 'down';
      },
      after: async ({ ujuzi }) => {
        ujuzi.mode = 'ok';
        return [];
      } },

    // ---- O4 / S3: POST /api/crew-trainings ---------------------------------------------------
    { operation: 'POST /api/crew-trainings', label: 'the organiser books crew training for their event', url: '/api/crew-trainings', headers: as('ownerToken'),
      body: (ctx: Ctx) => ({ eventId: need(ctx, 'eventId'), courseId: 'crs_501', crewSize: 6, preferredStart: inDays(30) }),
      expectStatus: 201, expectHeaders: { location: /^\/api\/crew-trainings\/trn_\d+$/ },
      check: all(field('status', 'pending'), field('crewSize', 6), (body) => (JSON.stringify(body).includes('bkg_') ? 'Ujuzi’s booking id leaked' : undefined)),
      capture: (body, ctx) => {
        if (isObject(body)) ctx.trainingId = String(body.id);
      },
      after: async ({ ctx, get, ujuzi }, body) => {
        const one = await get(`/api/crew-trainings/${need(ctx, 'trainingId')}`, need(ctx, 'ownerToken'));
        const list = await get('/api/crew-trainings', need(ctx, 'ownerToken'));
        const booking = [...ujuzi.bookings.values()].at(-1);
        return [
          ...(JSON.stringify(one.body) === JSON.stringify(body) ? [] : ['GET /api/crew-trainings/{id} does not return what was created']),
          ...(JSON.stringify(list.body) === JSON.stringify([body]) ? [] : ['the organiser’s list is not exactly the new training']),
          ...(booking?.eventName === 'Verification gala' && booking.crewSize === 6 ? [] : ['Ujuzi was not given the right booking']),
        ];
      } },
    { operation: 'POST /api/crew-trainings', label: 'no login', url: '/api/crew-trainings',
      body: (ctx: Ctx) => ({ eventId: need(ctx, 'eventId'), courseId: 'crs_501', crewSize: 6, preferredStart: inDays(30) }), expectStatus: 401, unchanged: true },
    { operation: 'POST /api/crew-trainings', label: 'crew of 41', url: '/api/crew-trainings', headers: as('ownerToken'),
      body: (ctx: Ctx) => ({ eventId: need(ctx, 'eventId'), courseId: 'crs_501', crewSize: 41, preferredStart: inDays(30) }), expectStatus: 400, unchanged: true,
      check: messageContains('crewSize must be a whole number from 1 to 40') },
    { operation: 'POST /api/crew-trainings', label: 'training would start after the event', url: '/api/crew-trainings', headers: as('ownerToken'),
      body: (ctx: Ctx) => ({ eventId: need(ctx, 'eventId'), courseId: 'crs_501', crewSize: 6, preferredStart: inDays(91) }), expectStatus: 400, unchanged: true,
      check: messageContains('preferredStart must be before the event starts') },
    { operation: 'POST /api/crew-trainings', label: 'tries to set the status', url: '/api/crew-trainings', headers: as('ownerToken'),
      body: (ctx: Ctx) => ({ eventId: need(ctx, 'eventId'), courseId: 'crs_501', crewSize: 6, preferredStart: inDays(30), status: 'confirmed' }),
      expectStatus: 400, unchanged: true, check: messageContains('Unknown field "status"') },
    { operation: 'POST /api/crew-trainings', label: 'unknown event', url: '/api/crew-trainings', headers: as('ownerToken'),
      body: { eventId: 'evt_9999', courseId: 'crs_501', crewSize: 6, preferredStart: inDays(30) }, expectStatus: 404, unchanged: true, check: messageContains('evt_9999') },
    { operation: 'POST /api/crew-trainings', label: 'another organiser’s event', url: '/api/crew-trainings', headers: as('strangerToken'),
      body: (ctx: Ctx) => ({ eventId: need(ctx, 'eventId'), courseId: 'crs_501', crewSize: 6, preferredStart: inDays(30) }), expectStatus: 403, unchanged: true,
      check: messageContains('only book training for events you created') },
    { operation: 'POST /api/crew-trainings', label: 'a course Ujuzi does not have', url: '/api/crew-trainings', headers: as('ownerToken'),
      body: (ctx: Ctx) => ({ eventId: need(ctx, 'eventId'), courseId: 'crs_999', crewSize: 6, preferredStart: inDays(30) }), expectStatus: 404, unchanged: true,
      check: messageContains('Course crs_999 not found') },
    { operation: 'POST /api/crew-trainings', label: 'Ujuzi is down: our own 502, nothing recorded', url: '/api/crew-trainings', headers: as('ownerToken'),
      body: (ctx: Ctx) => ({ eventId: need(ctx, 'eventId'), courseId: 'crs_501', crewSize: 6, preferredStart: inDays(30) }), expectStatus: 502, unchanged: true,
      check: messageContains('Ujuzi is not responding right now'),
      before: async ({ ujuzi }) => {
        ujuzi.mode = 'down';
      },
      after: async ({ ujuzi }) => {
        ujuzi.mode = 'ok';
        return ujuzi.bookings.size === 1 ? [] : [`Ujuzi holds ${ujuzi.bookings.size} bookings, expected 1`];
      } },

    // ---- O4 / S4: GET /api/crew-trainings and /{trainingId} ----------------------------------
    { operation: 'GET /api/crew-trainings', label: 'the organiser’s own trainings', url: '/api/crew-trainings', headers: as('ownerToken'),
      expectStatus: 200, unchanged: true, check: (body, ctx) => (asArray(body).length === 1 && asArray(body)[0].id === ctx.trainingId ? undefined : 'expected exactly the one booked') },
    { operation: 'GET /api/crew-trainings', label: 'another organiser sees none of them', url: '/api/crew-trainings', headers: as('strangerToken'),
      expectStatus: 200, unchanged: true, check: isEmptyArray },
    { operation: 'GET /api/crew-trainings', label: 'no login', url: '/api/crew-trainings', expectStatus: 401, unchanged: true },
    { operation: 'GET /api/crew-trainings/{trainingId}', label: 'one training', url: (ctx) => `/api/crew-trainings/${need(ctx, 'trainingId')}`,
      headers: as('ownerToken'), expectStatus: 200, unchanged: true, check: (body, ctx) => hasId(need(ctx, 'trainingId'))(body) },
    { operation: 'GET /api/crew-trainings/{trainingId}', label: 'another organiser’s training', url: (ctx) => `/api/crew-trainings/${need(ctx, 'trainingId')}`,
      headers: as('strangerToken'), expectStatus: 403, unchanged: true, check: messageContains('only see your own crew trainings') },
    { operation: 'GET /api/crew-trainings/{trainingId}', label: 'unknown training', url: '/api/crew-trainings/trn_9999', headers: as('ownerToken'),
      expectStatus: 404, unchanged: true, check: messageContains('trn_9999') },

    // ---- O4 / S5: PUT /api/crew-trainings/{trainingId} ---------------------------------------
    { operation: 'PUT /api/crew-trainings/{trainingId}', label: 'replace crew size and start', url: (ctx) => `/api/crew-trainings/${need(ctx, 'trainingId')}`,
      headers: as('ownerToken'), body: putBody, expectStatus: 200, check: all(field('crewSize', 9), field('preferredStart', putBody.preferredStart)),
      capture: (body, ctx) => {
        ctx.putResult = JSON.stringify(body);
      },
      after: async ({ ctx, get, ujuzi }) => {
        const one = await get(`/api/crew-trainings/${need(ctx, 'trainingId')}`, need(ctx, 'ownerToken'));
        const booking = [...ujuzi.bookings.values()][0];
        return [
          ...(JSON.stringify(one.body) === ctx.putResult ? [] : ['GET does not show the change']),
          ...(booking?.crewSize === 9 ? [] : ['Ujuzi’s booking was not changed']),
        ];
      } },
    { operation: 'PUT /api/crew-trainings/{trainingId}', label: 'the same body again gives the same result (idempotent)', url: (ctx) => `/api/crew-trainings/${need(ctx, 'trainingId')}`,
      headers: as('ownerToken'), body: putBody, expectStatus: 200,
      check: (body, ctx) => (JSON.stringify(body) === need(ctx, 'putResult') ? undefined : 'the second PUT gave a different result') },
    { operation: 'PUT /api/crew-trainings/{trainingId}', label: 'crew of 0', url: (ctx) => `/api/crew-trainings/${need(ctx, 'trainingId')}`,
      headers: as('ownerToken'), body: { crewSize: 0, preferredStart: inDays(35) }, expectStatus: 400, unchanged: true, check: messageContains('crewSize must be a whole number') },
    { operation: 'PUT /api/crew-trainings/{trainingId}', label: 'another organiser', url: (ctx) => `/api/crew-trainings/${need(ctx, 'trainingId')}`,
      headers: as('strangerToken'), body: putBody, expectStatus: 403, unchanged: true, check: messageContains('only change your own crew trainings') },
    { operation: 'PUT /api/crew-trainings/{trainingId}', label: 'unknown training', url: '/api/crew-trainings/trn_9999', headers: as('ownerToken'),
      body: putBody, expectStatus: 404, unchanged: true },
    { operation: 'PUT /api/crew-trainings/{trainingId}', label: 'Ujuzi is down: our own 502, nothing changed', url: (ctx) => `/api/crew-trainings/${need(ctx, 'trainingId')}`,
      headers: as('ownerToken'), body: { crewSize: 5, preferredStart: inDays(36) }, expectStatus: 502, unchanged: true,
      before: async ({ ujuzi }) => {
        ujuzi.mode = 'down';
      },
      after: async ({ ujuzi }) => {
        ujuzi.mode = 'ok';
        return [];
      } },
    { operation: 'POST /api/crew-trainings', label: 'a second booking, for the decision cases', url: '/api/crew-trainings', headers: as('ownerToken'),
      body: (ctx: Ctx) => ({ eventId: need(ctx, 'eventId'), courseId: 'crs_502', crewSize: 3, preferredStart: inDays(31) }), expectStatus: 201,
      capture: (body, ctx) => {
        if (isObject(body)) ctx.training2Id = String(body.id);
      } },
    { operation: 'PUT /api/crew-trainings/{trainingId}', label: 'the centre decided first: 409, and our copy catches up', url: (ctx) => `/api/crew-trainings/${need(ctx, 'training2Id')}`,
      headers: as('ownerToken'), body: putBody, expectStatus: 409, check: messageContains('is now confirmed'),
      before: async ({ ujuzi }) => {
        ujuzi.decide([...ujuzi.bookings.keys()].at(-1) as string, 'confirmed'); // the training centre's staff confirm it
      },
      after: async ({ ctx, get }) => {
        const one = await get(`/api/crew-trainings/${need(ctx, 'training2Id')}`, need(ctx, 'ownerToken'));
        return isObject(one.body) && one.body.status === 'confirmed' ? [] : ['our copy still says pending'];
      } },

    // ---- O4 / S5: DELETE /api/crew-trainings/{trainingId} ------------------------------------
    { operation: 'DELETE /api/crew-trainings/{trainingId}', label: 'a decided training cannot be cancelled', url: (ctx) => `/api/crew-trainings/${need(ctx, 'training2Id')}`,
      headers: as('ownerToken'), expectStatus: 409, unchanged: true, check: messageContains('only pending crew trainings can be cancelled') },
    { operation: 'DELETE /api/crew-trainings/{trainingId}', label: 'another organiser', url: (ctx) => `/api/crew-trainings/${need(ctx, 'trainingId')}`,
      headers: as('strangerToken'), expectStatus: 403, unchanged: true },
    { operation: 'DELETE /api/crew-trainings/{trainingId}', label: 'Ujuzi is down: our own 502, training kept', url: (ctx) => `/api/crew-trainings/${need(ctx, 'trainingId')}`,
      headers: as('ownerToken'), expectStatus: 502, unchanged: true,
      before: async ({ ujuzi }) => {
        ujuzi.mode = 'down';
      },
      after: async ({ ujuzi }) => {
        ujuzi.mode = 'ok';
        return [];
      } },
    { operation: 'DELETE /api/crew-trainings/{trainingId}', label: 'the organiser cancels a pending training', url: (ctx) => `/api/crew-trainings/${need(ctx, 'trainingId')}`,
      headers: as('ownerToken'), expectStatus: 204,
      after: async ({ ctx, get, ujuzi }) => {
        const gone = await get(`/api/crew-trainings/${need(ctx, 'trainingId')}`, need(ctx, 'ownerToken'));
        return [
          ...(gone.status === 404 ? [] : [`the cancelled training can still be read (status ${gone.status})`]),
          ...(ujuzi.bookings.size === 1 ? [] : [`Ujuzi holds ${ujuzi.bookings.size} bookings, expected only the decided one`]),
        ];
      } },
    { operation: 'DELETE /api/crew-trainings/{trainingId}', label: 'the same training again', url: (ctx) => `/api/crew-trainings/${need(ctx, 'trainingId')}`,
      headers: as('ownerToken'), expectStatus: 404, unchanged: true },

    // ---- O5 / S2: POST /api/certificate-checks -----------------------------------------------
    { operation: 'POST /api/certificate-checks', label: 'a valid certificate', url: '/api/certificate-checks', headers: as('ownerToken'),
      body: { certificateNo: 'UJZ-2026-00123' }, expectStatus: 201, expectHeaders: { 'cache-control': 'no-store' },
      check: all(field('valid', true), field('holder', 'Achieng O.'), (body) => (isObject(body) && /^chk_\d+$/.test(String(body.id)) ? undefined : 'id is not chk_...')),
      after: async ({ ctx, store }) => {
        const saved = await store.certificateChecks.listByOrganiser(need(ctx, 'ownerId'));
        return saved.length === 1 && saved[0].certificate_no === 'UJZ-2026-00123' ? [] : ['the check was not recorded'];
      } },
    { operation: 'POST /api/certificate-checks', label: 'a revoked certificate is recorded with valid false', url: '/api/certificate-checks', headers: as('ownerToken'),
      body: { certificateNo: 'ujz-2026-00124' }, expectStatus: 201, check: all(field('valid', false), field('certificateNo', 'UJZ-2026-00124')) },
    { operation: 'POST /api/certificate-checks', label: 'a number Ujuzi does not know', url: '/api/certificate-checks', headers: as('ownerToken'),
      body: { certificateNo: 'UJZ-2026-99999' }, expectStatus: 404, unchanged: true, check: messageContains('Certificate UJZ-2026-99999 not found') },
    { operation: 'POST /api/certificate-checks', label: 'a number in the wrong format', url: '/api/certificate-checks', headers: as('ownerToken'),
      body: { certificateNo: 'ABC-1' }, expectStatus: 400, unchanged: true, check: messageContains('certificateNo must look like') },
    { operation: 'POST /api/certificate-checks', label: 'no login', url: '/api/certificate-checks', body: { certificateNo: 'UJZ-2026-00123' }, expectStatus: 401, unchanged: true },
    { operation: 'POST /api/certificate-checks', label: 'Ujuzi is down: our own 502, nothing recorded', url: '/api/certificate-checks', headers: as('ownerToken'),
      body: { certificateNo: 'UJZ-2026-00123' }, expectStatus: 502, unchanged: true,
      before: async ({ ujuzi }) => {
        ujuzi.mode = 'down';
      },
      after: async ({ ujuzi }) => {
        ujuzi.mode = 'ok';
        return [];
      } },
  ];
}
