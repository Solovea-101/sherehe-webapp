import request from 'supertest';
import { sha256Hex } from '@/lib/auth/hash';
import { getStore } from '@/lib/db';
import { newOrganiser } from './helpers/auth';
import { inDays } from './helpers/dates';
import { useTestServer } from './helpers/server';
import { organiserWithEvent, useUjuziStub } from './helpers/ujuziWorld';

// Week 9, Part D: what the API gives away. Each describe block is one item of the audit checklist
// (SECURITY_AUDIT.md says what was found). These are checks of behaviour, so they send real requests.
const app = useTestServer();
const ujuzi = useUjuziStub();

const KAZI_KEY = 'shk_kazi-connect-test-key-0123456789';
beforeEach(() => {
  process.env.PARTNER_KEYS = `kazi:${sha256Hex(KAZI_KEY)}`;
});
afterEach(() => {
  process.env.PARTNER_KEYS = '';
});

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** Every key name used anywhere inside a JSON value. */
function keyNames(value: Json, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => keyNames(v, found));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      found.add(k);
      keyNames(v, found);
    }
  }
  return found;
}
/** Every string used anywhere inside a JSON value. */
function strings(value: Json, found: string[] = []): string[] {
  if (typeof value === 'string') found.push(value);
  else if (Array.isArray(value)) value.forEach((v) => strings(v, found));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => strings(v, found));
  return found;
}

const NEVER_SHOWN = ['password', 'passwordHash', 'password_hash', 'tokenHash', 'token_hash', 'ujuzi_booking_id', 'ujuziBookingId', 'bookingId', 'organiser_id', 'organiserId', 'userId', 'user_id'];
const SCARY = /(\bat \S+:\d+:\d+)|node_modules|\/Users\/|\.tsx?\b|SELECT |INSERT |UPDATE |DELETE FROM|pg_|relation "|stack|ECONN|ENOENT|TypeError|SyntaxError|Unexpected token/i;

describe('Part D: sensitive fields', () => {
  it('no response shows a password, a hash, a booking id or an owner id, and only the caller sees an email', async () => {
    const me = await organiserWithEvent(app());
    ujuzi().reset();
    const role = await request(app()).post(`/api/events/${me.eventId}/roles`).set(me.auth).send({
      title: 'Ushers', category: 'events', headcount: 5, shiftStart: inDays(60, 8), shiftEnd: inDays(60, 18), payPerShift: 1500,
    });
    const store = await getStore();
    const offer = await store.offers.create({ role_id: role.body.id, event_id: me.eventId, workers_offered: 2, note: 'two' });
    const training = await request(app()).post('/api/crew-trainings').set(me.auth).send({
      eventId: me.eventId, courseId: 'crs_501', crewSize: 6, preferredStart: inDays(30),
    });
    expect(training.status).toBe(201);
    const check = await request(app()).post('/api/certificate-checks').set(me.auth).send({ certificateNo: 'UJZ-2026-00123' });

    const partner = { 'X-API-Key': KAZI_KEY };
    const responses: Array<[string, { status: number; body: Json }]> = [
      ['GET /api/events (key)', await request(app()).get('/api/events?status=upcoming').set(partner)],
      ['GET /api/events/{id} (key)', await request(app()).get(`/api/events/${me.eventId}`).set(partner)],
      ['GET /api/events/{id}/roles (key)', await request(app()).get(`/api/events/${me.eventId}/roles`).set(partner)],
      ['GET /api/events/{id}/offers (organiser)', await request(app()).get(`/api/events/${me.eventId}/offers`).set(me.auth)],
      ['GET /api/offers/{id} (key)', await request(app()).get(`/api/offers/${offer.id}`).set(partner)],
      ['POST /api/offers (key)', await request(app()).post('/api/offers').set(partner).send({ roleId: 'rol_3001', workersOffered: 1 })],
      ['GET /api/crew-trainings', await request(app()).get('/api/crew-trainings').set(me.auth)],
      ['GET /api/crew-trainings/{id}', await request(app()).get(`/api/crew-trainings/${training.body.id}`).set(me.auth)],
      ['POST /api/crew-trainings', training],
      ['GET /api/training-options', await request(app()).get('/api/training-options').set(me.auth)],
      ['POST /api/certificate-checks', check],
      ['POST /api/events', await request(app()).post('/api/events').set(me.auth).send({
        name: 'Another', type: 'wedding', county: 'Nairobi', area: 'Westlands', venue: 'Hall', startsAt: inDays(70), endsAt: inDays(70, 20), expectedGuests: 10,
      })],
    ];
    for (const [label, res] of responses) {
      expect([label, res.status < 500]).toEqual([label, true]);
      const names = keyNames(res.body);
      for (const forbidden of NEVER_SHOWN) expect([label, names.has(forbidden)]).toEqual([label, false]);
      expect([label, names.has('email')]).toEqual([label, false]);
      expect([label, strings(res.body).some((s) => /^[0-9a-f]{64}$/.test(s))]).toEqual([label, false]); // no SHA-256 or token-like value
      expect([label, strings(res.body).some((s) => s.includes(me.email))]).toEqual([label, false]);
    }
  });

  it('the account answers show the caller their own email and a token, and no hash', async () => {
    const reg = await request(app()).post('/api/auth/register').send({ email: 'someone@example.com', name: 'Some One', password: 'a long enough password' });
    expect(reg.status).toBe(201);
    expect(Object.keys(reg.body).sort()).toEqual(['expiresAt', 'token', 'user']);
    expect(Object.keys(reg.body.user).sort()).toEqual(['email', 'id', 'name']);
    const me = await request(app()).get('/api/me').set({ Authorization: `Bearer ${reg.body.token}` });
    expect(Object.keys(me.body).sort()).toEqual(['email', 'id', 'name']);
    const login = await request(app()).post('/api/auth/login').send({ email: 'someone@example.com', password: 'a long enough password' });
    expect(Object.keys(login.body).sort()).toEqual(['expiresAt', 'token', 'user']);
    for (const res of [reg, me, login]) {
      expect(res.headers['cache-control']).toBe('no-store');
      expect(JSON.stringify(res.body)).not.toMatch(/scrypt|\$|password/i);
    }
  });

  it('the stored token is a hash: the token itself is nowhere in the database', async () => {
    const me = await newOrganiser(app());
    const store = await getStore();
    expect(await store.sessions.findByTokenHash(me.token)).toBeNull();
    expect(await store.sessions.findByTokenHash(sha256Hex(me.token))).not.toBeNull();
  });

  it('login answers the same for an unknown email and a wrong password', async () => {
    const me = await newOrganiser(app());
    const wrong = await request(app()).post('/api/auth/login').send({ email: me.email, password: 'definitely not it' });
    const unknown = await request(app()).post('/api/auth/login').send({ email: 'nobody@example.com', password: 'definitely not it' });
    expect([wrong.status, unknown.status]).toEqual([401, 401]);
    expect(wrong.body).toEqual(unknown.body);
  });
});

describe("Part D: other people's data", () => {
  it('another organiser gets 403 on every route that takes an id of something that is not theirs', async () => {
    const owner = await organiserWithEvent(app());
    const intruder = await newOrganiser(app());
    const role = await request(app()).post(`/api/events/${owner.eventId}/roles`).set(owner.auth).send({
      title: 'Ushers', category: 'events', headcount: 5, shiftStart: inDays(60, 8), shiftEnd: inDays(60, 18), payPerShift: 1500,
    });
    const store = await getStore();
    const offer = await store.offers.create({ role_id: role.body.id, event_id: owner.eventId, workers_offered: 2, note: '' });
    const training = await request(app()).post('/api/crew-trainings').set(owner.auth).send({
      eventId: owner.eventId, courseId: 'crs_501', crewSize: 6, preferredStart: inDays(30),
    });
    const t = training.body.id;

    const attempts: Array<[string, request.Test]> = [
      ['GET event offers', request(app()).get(`/api/events/${owner.eventId}/offers`).set(intruder.auth)],
      ['POST role on their event', request(app()).post(`/api/events/${owner.eventId}/roles`).set(intruder.auth).send({
        title: 'Ushers', category: 'events', headcount: 5, shiftStart: inDays(60, 8), shiftEnd: inDays(60, 18), payPerShift: 1500,
      })],
      ['PATCH their offer', request(app()).patch(`/api/offers/${offer.id}`).set(intruder.auth).send({ status: 'accepted' })],
      ['GET their crew training', request(app()).get(`/api/crew-trainings/${t}`).set(intruder.auth)],
      ['PUT their crew training', request(app()).put(`/api/crew-trainings/${t}`).set(intruder.auth).send({ crewSize: 9, preferredStart: inDays(31) })],
      ['DELETE their crew training', request(app()).delete(`/api/crew-trainings/${t}`).set(intruder.auth)],
      ['book on their event', request(app()).post('/api/crew-trainings').set(intruder.auth).send({ eventId: owner.eventId, courseId: 'crs_502', crewSize: 3, preferredStart: inDays(30) })],
    ];
    for (const [label, pending] of attempts) {
      const res = await pending;
      expect([label, res.status]).toEqual([label, 403]);
    }
    // nothing changed
    expect((await store.offers.get(offer.id))?.status).toBe('pending');
    expect((await request(app()).get(`/api/crew-trainings/${t}`).set(owner.auth)).body.crewSize).toBe(6);
  });

  it('the intruder’s own list never contains the owner’s crew trainings', async () => {
    const owner = await organiserWithEvent(app());
    await request(app()).post('/api/crew-trainings').set(owner.auth).send({ eventId: owner.eventId, courseId: 'crs_501', crewSize: 6, preferredStart: inDays(30) });
    const intruder = await newOrganiser(app());
    expect((await request(app()).get('/api/crew-trainings').set(intruder.auth)).body).toEqual([]);
  });
});

describe('Part D: error messages', () => {
  const evil = ["' OR 1=1 --", '../../etc/passwd', '%00', '%', '😀', 'x'.repeat(5000), '<script>alert(1)</script>', '${process.env.PATH}'];

  it('bad ids, bodies and methods answer a short { message } and nothing from inside the server', async () => {
    const me = await organiserWithEvent(app());
    const calls: Array<[string, request.Test]> = [];
    for (const id of evil) {
      const e = encodeURIComponent(id);
      calls.push(
        [`GET event ${id.slice(0, 20)}`, request(app()).get(`/api/events/${e}`).set(me.auth)],
        [`GET roles ${id.slice(0, 20)}`, request(app()).get(`/api/events/${e}/roles`).set(me.auth)],
        [`GET offer ${id.slice(0, 20)}`, request(app()).get(`/api/offers/${e}`).set({ 'X-API-Key': KAZI_KEY })],
        [`DELETE offer ${id.slice(0, 20)}`, request(app()).delete(`/api/offers/${e}`).set({ 'X-API-Key': KAZI_KEY })],
        [`GET training ${id.slice(0, 20)}`, request(app()).get(`/api/crew-trainings/${e}`).set(me.auth)],
        [`county ${id.slice(0, 20)}`, request(app()).get(`/api/events?status=upcoming&county=${e}`).set(me.auth)],
      );
    }
    calls.push(
      ['not JSON', request(app()).post('/api/events').set(me.auth).set('Content-Type', 'application/json').send('{"name":')],
      ['array body', request(app()).post('/api/events').set(me.auth).send([1, 2, 3])],
      ['null body', request(app()).post('/api/events').set(me.auth).set('Content-Type', 'application/json').send('null')],
      ['too big', request(app()).post('/api/events').set(me.auth).set('Content-Type', 'application/json').send(JSON.stringify({ name: 'x'.repeat(30_000) }))],
      ['unknown path', request(app()).get('/api/nothing/here/at/all').set(me.auth)],
      ['wrong method', request(app()).patch('/api/events').set(me.auth)],
      ['bad token', request(app()).get('/api/me').set({ Authorization: 'Bearer ' + 'a'.repeat(5000) })],
      ['bad key', request(app()).get('/api/events?status=upcoming').set({ 'X-API-Key': 'k'.repeat(5000) })],
    );
    for (const [label, pending] of calls) {
      const res = await pending;
      expect([label, res.status >= 400 && res.status < 500]).toEqual([label, true]); // never a 500
      expect([label, res.headers['content-type']?.startsWith('application/json')]).toEqual([label, true]);
      expect([label, Object.keys(res.body)]).toEqual([label, ['message']]);
      expect([label, SCARY.test(String(res.body.message))]).toEqual([label, false]);
      expect([label, String(res.body.message).length < 300]).toEqual([label, true]);
    }
  });

  it('an unexpected failure answers a plain 500 that says nothing about the cause', async () => {
    const store = await getStore();
    const real = store.events.get.bind(store.events);
    store.events.get = async () => {
      throw new Error('connect ECONNREFUSED 10.0.0.5:5432 at /Users/x/node_modules/pg/lib/client.js:12:3 SELECT * FROM events');
    };
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const me = await newOrganiser(app());
      const res = await request(app()).get('/api/events/evt_2001').set(me.auth);
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ message: 'Something went wrong on our side. Please try again.' });
    } finally {
      store.events.get = real;
      jest.restoreAllMocks();
    }
  });
});

describe('Part D: extra fields on writes', () => {
  const event = { name: 'Extra fields', type: 'wedding', county: 'Nairobi', area: 'Westlands', venue: 'Hall', startsAt: inDays(70), endsAt: inDays(70, 20), expectedGuests: 10 };

  it.each([
    ['id', { id: 'evt_9999' }],
    ['organiserId', { organiserId: 'usr_1001' }],
    ['organiser_id', { organiser_id: 'usr_1001' }],
    ['status', { status: 'cancelled' }],
    ['isAdmin', { isAdmin: true }],
    ['createdAt', { createdAt: '2020-01-01T00:00:00Z' }],
  ])('POST /api/events refuses %s', async (_name, extra) => {
    const me = await newOrganiser(app());
    const res = await request(app()).post('/api/events').set(me.auth).send({ ...event, ...extra });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body)).toEqual(['message']);
  });

  it.each([
    ['filled', { filled: 99 }],
    ['id', { id: 'rol_9999' }],
    ['eventId', { eventId: 'evt_2001' }],
  ])('POST /api/events/{id}/roles refuses %s', async (_name, extra) => {
    const me = await organiserWithEvent(app());
    const res = await request(app()).post(`/api/events/${me.eventId}/roles`).set(me.auth).send({
      title: 'Ushers', category: 'events', headcount: 5, shiftStart: inDays(60, 8), shiftEnd: inDays(60, 18), payPerShift: 1500, ...extra,
    });
    expect(res.status).toBe(400);
  });

  it.each([
    ['status', { status: 'accepted' }],
    ['id', { id: 'ofr_9999' }],
    ['eventId', { eventId: 'evt_2002' }],
  ])('POST /api/offers refuses %s', async (_name, extra) => {
    const res = await request(app()).post('/api/offers').set({ 'X-API-Key': KAZI_KEY }).send({ roleId: 'rol_3001', workersOffered: 1, ...extra });
    expect(res.status).toBe(400);
  });

  it('PATCH /api/offers/{id} accepts only status', async () => {
    const me = await organiserWithEvent(app());
    const role = await request(app()).post(`/api/events/${me.eventId}/roles`).set(me.auth).send({
      title: 'Ushers', category: 'events', headcount: 5, shiftStart: inDays(60, 8), shiftEnd: inDays(60, 18), payPerShift: 1500,
    });
    const store = await getStore();
    const offer = await store.offers.create({ role_id: role.body.id, event_id: me.eventId, workers_offered: 2, note: '' });
    const res = await request(app()).patch(`/api/offers/${offer.id}`).set(me.auth).send({ status: 'accepted', workersOffered: 5 });
    expect(res.status).toBe(400);
    expect((await store.offers.get(offer.id))?.workers_offered).toBe(2);
  });

  it('POST /api/auth/register refuses isAdmin and id, and the account is not made', async () => {
    const res = await request(app()).post('/api/auth/register').send({ email: 'sneaky@example.com', name: 'Sneaky', password: 'a long enough password', isAdmin: true, id: 'usr_1001' });
    expect(res.status).toBe(400);
    const store = await getStore();
    expect(await store.users.findByEmail('sneaky@example.com')).toBeNull();
  });
});

describe('Part D: headers', () => {
  it('does not announce the framework and tells browsers not to guess content types', async () => {
    const me = await newOrganiser(app());
    for (const path of ['/api/me', '/api/events/evt_2001', '/api/nothing', '/']) {
      const res = await request(app()).get(path).set(me.auth);
      expect([path, res.headers['x-powered-by']]).toEqual([path, undefined]);
      expect([path, res.headers['x-content-type-options']]).toEqual([path, 'nosniff']);
    }
  });
});
