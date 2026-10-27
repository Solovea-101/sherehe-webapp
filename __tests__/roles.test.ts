import request from 'supertest';
import { getStore } from '@/lib/db';
import type { ApiRole } from '@/lib/mappers';
import { newOrganiser } from './helpers/auth';
import { inDays } from './helpers/dates';
import { useTestServer } from './helpers/server';
import { ISO_DATE, ROLE_KEYS, keysOf } from './helpers/shapes';

const app = useTestServer();

describe('GET /api/events/{eventId}/roles (K2)', () => {
  it('lists the roles of an event as a bare array', async () => {
    const res = await request(app()).get('/api/events/evt_2001/roles');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.body).toEqual([
      {
        id: 'rol_3001', eventId: 'evt_2001', title: 'Waiters', category: 'catering', headcount: 6, filled: 0,
        shiftStart: '2026-12-05T13:00:00Z', shiftEnd: '2026-12-05T23:00:00Z', payPerShift: 1500,
      },
      {
        id: 'rol_3002', eventId: 'evt_2001', title: 'Ushers', category: 'events', headcount: 4, filled: 0,
        shiftStart: '2026-12-05T13:30:00Z', shiftEnd: '2026-12-05T22:30:00Z', payPerShift: 1200,
      },
    ]);
  });

  it('returns exactly the contract fields, with ISO dates and whole-number money', async () => {
    const res = await request(app()).get('/api/events/evt_2005/roles');
    expect(res.body.length).toBe(2);
    for (const role of res.body as ApiRole[]) {
      expect(keysOf(role)).toEqual(ROLE_KEYS);
      expect(role.eventId).toBe('evt_2005');
      expect(role.shiftStart).toMatch(ISO_DATE);
      expect(role.shiftEnd).toMatch(ISO_DATE);
      expect(Number.isInteger(role.payPerShift)).toBe(true);
      expect(Number.isInteger(role.headcount) && Number.isInteger(role.filled)).toBe(true);
    }
  });

  it('only returns roles of the requested event, with categories from the shared list', async () => {
    const shared = ['accommodation', 'campus', 'catering', 'cleaning', 'electrical', 'events', 'plumbing', 'security', 'tutoring'];
    for (const id of ['evt_2001', 'evt_2002', 'evt_2003', 'evt_2004', 'evt_2005', 'evt_2006']) {
      const res = await request(app()).get(`/api/events/${id}/roles`);
      expect(res.status).toBe(200);
      expect(res.body.length).toBeGreaterThan(0);
      for (const role of res.body as ApiRole[]) {
        expect(role.eventId).toBe(id);
        expect(shared).toContain(role.category);
      }
    }
  });

  it('answers 200 with [] for an event that has no roles yet', async () => {
    const store = await getStore();
    const bare = await store.events.create({
      organiser_id: 'usr_1001', name: 'No roles yet', type: 'other', county: 'Nakuru', area: 'Milimani',
      venue: 'Hall', starts_at: new Date('2027-02-01T10:00:00Z'), ends_at: new Date('2027-02-01T12:00:00Z'),
      expected_guests: 10, status: 'upcoming',
    });
    const res = await request(app()).get(`/api/events/${bare.id}/roles`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('shows a role that is already full, and a role added after the server started', async () => {
    const full = await request(app()).get('/api/events/evt_2007/roles');
    expect(full.status).toBe(200);
    expect(full.body[0]).toMatchObject({ id: 'rol_3011', headcount: 2, filled: 2 });

    const store = await getStore();
    const added = await store.roles.create({
      event_id: 'evt_2006', title: 'Bartenders', category: 'catering', headcount: 2, filled: 0,
      shift_start: new Date('2026-12-27T14:00:00.500Z'), shift_end: new Date('2026-12-27T23:00:00Z'), pay_per_shift: 1600,
    });
    const res = await request(app()).get('/api/events/evt_2006/roles');
    expect(res.body.map((r: ApiRole) => r.id)).toEqual(['rol_3010', added.id]);
    expect(res.body[1].shiftStart).toBe('2026-12-27T14:00:00Z');
  });

  it('answers 404 { message } for an unknown event, not []', async () => {
    const res = await request(app()).get('/api/events/evt_9999/roles');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Event evt_9999 not found' });
  });

  it('does not treat a role id as an event id', async () => {
    const res = await request(app()).get('/api/events/rol_3001/roles');
    expect(res.status).toBe(404);
  });
});

describe('POST /api/events/{eventId}/roles (O2)', () => {
  const newRole = () => ({
    title: 'Security guards', category: 'security', headcount: 4, shiftStart: inDays(60, 12), shiftEnd: inDays(60, 23), payPerShift: 1800,
  });
  const postTo = (eventId: string, body: unknown, auth?: { Authorization: string }) => {
    const req = request(app()).post(`/api/events/${eventId}/roles`).set('Content-Type', 'application/json');
    return (auth ? req.set(auth) : req).send(JSON.stringify(body));
  };
  const myEvent = async (me: { auth: { Authorization: string } }) =>
    (
      await request(app()).post('/api/events').set(me.auth).send({
        name: 'My event', type: 'concert', county: 'Kisumu', area: 'Milimani', venue: 'Hall',
        startsAt: inDays(60), endsAt: inDays(60, 20), expectedGuests: 100,
      })
    ).body.id as string;

  it('adds a role with nobody confirmed yet, and partners can read it', async () => {
    const me = await newOrganiser(app());
    const eventId = await myEvent(me);
    const res = await postTo(eventId, newRole(), me.auth);
    expect(res.status).toBe(201);
    expect(keysOf(res.body)).toEqual(ROLE_KEYS);
    expect(res.body).toMatchObject({ ...newRole(), eventId, filled: 0 });
    expect(res.body.id).toMatch(/^rol_\d+$/);
    expect(res.body.shiftStart).toMatch(ISO_DATE);

    const read = await request(app()).get(`/api/events/${eventId}/roles`);
    expect(read.body).toEqual([res.body]);
  });

  it('accepts every shared category and the extreme numbers', async () => {
    const me = await newOrganiser(app());
    const eventId = await myEvent(me);
    for (const category of ['accommodation', 'campus', 'catering', 'cleaning', 'electrical', 'events', 'plumbing', 'security', 'tutoring']) {
      expect((await postTo(eventId, { ...newRole(), category }, me.auth)).status).toBe(201);
    }
    expect((await postTo(eventId, { ...newRole(), headcount: 1, payPerShift: 0 }, me.auth)).status).toBe(201);
    expect((await postTo(eventId, { ...newRole(), headcount: 1000, payPerShift: 100_000 }, me.auth)).status).toBe(201);
  });

  it('answers 401 without a login', async () => {
    expect((await postTo('evt_2001', newRole())).status).toBe(401);
  });

  it('answers 403 for someone else’s event, including the sample events, and adds nothing', async () => {
    const intruder = await newOrganiser(app());
    const res = await postTo('evt_2001', newRole(), intruder.auth);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ message: 'You can only add roles to events you created.' });
    expect((await request(app()).get('/api/events/evt_2001/roles')).body).toHaveLength(2);

    const owner = await newOrganiser(app());
    const eventId = await myEvent(owner);
    expect((await postTo(eventId, newRole(), intruder.auth)).status).toBe(403);
    expect((await request(app()).get(`/api/events/${eventId}/roles`)).body).toEqual([]);
  });

  it('answers 404 for an unknown event, before looking at the body', async () => {
    const me = await newOrganiser(app());
    expect((await postTo('evt_9999', newRole(), me.auth)).status).toBe(404);
    expect((await postTo('evt_9999', { nonsense: true }, me.auth)).status).toBe(404);
  });

  it('answers 409 when the event is no longer upcoming', async () => {
    const me = await newOrganiser(app());
    const eventId = await myEvent(me);
    const store = await getStore();
    // there is no API for finishing an event, so reach the store directly
    const event = (await store.events.get(eventId))!;
    const done = await store.events.create({ ...event, status: 'completed' });
    const res = await postTo(done.id, newRole(), me.auth);
    expect(res.status).toBe(409);
    expect(res.body.message).toBe(`Event ${done.id} is completed; roles can only be added to upcoming events`);
  });

  it.each([
    ['a missing title', (r: object) => ({ ...r, title: undefined }), 'title is required'],
    ['a blank title', (r: object) => ({ ...r, title: ' ' }), 'title cannot be empty'],
    ['a title over 80 characters', (r: object) => ({ ...r, title: 't'.repeat(81) }), 'at most 80'],
    ['a category outside the shared list', (r: object) => ({ ...r, category: 'baking' }), 'category must be one of accommodation'],
    ['a category in the wrong case', (r: object) => ({ ...r, category: 'Security' }), 'category must be one of'],
    ['zero workers', (r: object) => ({ ...r, headcount: 0 }), 'headcount must be a whole number from 1 to 1000'],
    ['too many workers', (r: object) => ({ ...r, headcount: 1001 }), 'headcount must be a whole number'],
    ['a fractional headcount', (r: object) => ({ ...r, headcount: 2.5 }), 'headcount must be a whole number'],
    ['a headcount sent as text', (r: object) => ({ ...r, headcount: '4' }), 'headcount must be a whole number'],
    ['a shift starting in the past', (r: object) => ({ ...r, shiftStart: '2020-01-01T08:00:00Z' }), 'shiftStart must be in the future'],
    ['a shift ending before it starts', (r: object) => ({ ...r, shiftEnd: inDays(60, 8) }), 'shiftEnd must be after shiftStart'],
    ['a shift with no end', (r: object) => ({ ...r, shiftEnd: undefined }), 'shiftEnd is required'],
    ['negative pay', (r: object) => ({ ...r, payPerShift: -1 }), 'payPerShift must be a whole number from 0 to 100000'],
    ['fractional pay', (r: object) => ({ ...r, payPerShift: 1500.5 }), 'payPerShift must be a whole number'],
    ['pay sent as text', (r: object) => ({ ...r, payPerShift: 'KES 1500' }), 'payPerShift must be a whole number'],
    ['an attempt to set filled', (r: object) => ({ ...r, filled: 4 }), 'Unknown field "filled"'],
    ['an attempt to set the event', (r: object) => ({ ...r, eventId: 'evt_2001' }), 'Unknown field "eventId"'],
  ])('answers 400 { message } for %s, and adds nothing', async (_label, mutate, text) => {
    const me = await newOrganiser(app());
    const eventId = await myEvent(me);
    const res = await postTo(eventId, mutate(newRole()), me.auth);
    expect(res.status).toBe(400);
    expect(keysOf(res.body)).toEqual(['message']);
    expect(res.body.message).toContain(text);
    expect((await request(app()).get(`/api/events/${eventId}/roles`)).body).toEqual([]);
  });

  it('answers 400 for a body that is not a JSON object', async () => {
    const me = await newOrganiser(app());
    const eventId = await myEvent(me);
    for (const body of [[], 'text', null]) expect((await postTo(eventId, body, me.auth)).status).toBe(400);
  });
});

describe('GET /api/events/{eventId}/offers (O3)', () => {
  const myEvent = async (me: { auth: { Authorization: string } }) =>
    (
      await request(app()).post('/api/events').set(me.auth).send({
        name: 'Offers event', type: 'other', county: 'Kisumu', area: 'Milimani', venue: 'Hall',
        startsAt: inDays(70), endsAt: inDays(70, 20), expectedGuests: 100,
      })
    ).body.id as string;

  it('lists the offers on the organiser’s event, oldest first, with exactly the contract fields', async () => {
    const me = await newOrganiser(app());
    const eventId = await myEvent(me);
    const store = await getStore();
    const roleA = await store.roles.create({
      event_id: eventId, title: 'A', category: 'catering', headcount: 5, filled: 0,
      shift_start: new Date(Date.now() + 8e9), shift_end: new Date(Date.now() + 8.1e9), pay_per_shift: 1000,
    });
    const roleB = await store.roles.create({ ...roleA, title: 'B' });
    const first = await store.offers.create({ role_id: roleA.id, event_id: eventId, workers_offered: 2, note: 'first' });
    const second = await store.offers.create({ role_id: roleB.id, event_id: eventId, workers_offered: 3, note: '' });

    const res = await request(app()).get(`/api/events/${eventId}/offers`).set(me.auth);
    expect(res.status).toBe(200);
    expect(res.body.map((o: { id: string }) => o.id)).toEqual([first.id, second.id]);
    for (const offer of res.body) expect(keysOf(offer)).toEqual(['createdAt', 'eventId', 'id', 'note', 'roleId', 'status', 'workersOffered']);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('answers 200 with [] when there are none', async () => {
    const me = await newOrganiser(app());
    const res = await request(app()).get(`/api/events/${await myEvent(me)}/offers`).set(me.auth);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('does not mix in offers from other events', async () => {
    const me = await newOrganiser(app());
    const store = await getStore();
    await store.offers.create({ role_id: 'rol_3005', event_id: 'evt_2003', workers_offered: 1, note: 'elsewhere' });
    expect((await request(app()).get(`/api/events/${await myEvent(me)}/offers`).set(me.auth)).body).toEqual([]);
  });

  it('answers 401 without a login, 403 for someone else’s event, 404 for an unknown event', async () => {
    const me = await newOrganiser(app());
    const stranger = await newOrganiser(app());
    const eventId = await myEvent(me);
    expect((await request(app()).get(`/api/events/${eventId}/offers`)).status).toBe(401);
    const forbidden = await request(app()).get(`/api/events/${eventId}/offers`).set(stranger.auth);
    expect(forbidden.status).toBe(403);
    expect(forbidden.body).toEqual({ message: 'You can only see the offers on events you created.' });
    expect((await request(app()).get('/api/events/evt_2001/offers').set(me.auth)).status).toBe(403); // a sample event
    const missing = await request(app()).get('/api/events/evt_9999/offers').set(me.auth);
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ message: 'Event evt_9999 not found' });
  });
});
