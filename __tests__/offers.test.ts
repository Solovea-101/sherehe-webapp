import request from 'supertest';
import { getStore } from '@/lib/db';
import { newOrganiser, type TestOrganiser } from './helpers/auth';
import { inDays } from './helpers/dates';
import { useTestServer } from './helpers/server';
import { ISO_DATE, OFFER_KEYS, keysOf } from './helpers/shapes';

const app = useTestServer();

describe('GET /api/offers/{offerId} (K4)', () => {
  it('returns an offer with exactly the contract fields', async () => {
    const store = await getStore();
    const offer = await store.offers.create({
      role_id: 'rol_3001', event_id: 'evt_2001', workers_offered: 6, note: 'Six trained catering students',
    });

    const res = await request(app()).get(`/api/offers/${offer.id}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(keysOf(res.body)).toEqual(OFFER_KEYS);
    expect(res.body).toEqual({
      id: offer.id,
      roleId: 'rol_3001',
      eventId: 'evt_2001',
      workersOffered: 6,
      note: 'Six trained catering students',
      status: 'pending',
      createdAt: expect.stringMatching(ISO_DATE),
    });
  });

  it('shows the new status once the organiser has decided', async () => {
    const store = await getStore();
    const offer = await store.offers.create({ role_id: 'rol_3002', event_id: 'evt_2001', workers_offered: 2, note: '' });

    for (const status of ['accepted', 'declined'] as const) {
      await store.offers.setStatus(offer.id, status);
      const res = await request(app()).get(`/api/offers/${offer.id}`);
      expect(res.body.status).toBe(status);
    }
  });

  it('sends an empty note as "" rather than leaving it out or sending null', async () => {
    const store = await getStore();
    const offer = await store.offers.create({ role_id: 'rol_3003', event_id: 'evt_2002', workers_offered: 1, note: '' });
    const res = await request(app()).get(`/api/offers/${offer.id}`);
    expect(res.body.note).toBe('');
  });

  it('answers 404 { message } for an unknown offer', async () => {
    const res = await request(app()).get('/api/offers/ofr_9999');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Offer ofr_9999 not found' });
  });

  it('answers 404 for an offer that was withdrawn', async () => {
    const store = await getStore();
    const offer = await store.offers.create({ role_id: 'rol_3004', event_id: 'evt_2002', workers_offered: 1, note: 'x' });
    expect((await request(app()).get(`/api/offers/${offer.id}`)).status).toBe(200);
    await store.offers.delete(offer.id);
    expect((await request(app()).get(`/api/offers/${offer.id}`)).status).toBe(404);
  });

  it('answers 404 for a malformed id', async () => {
    const res = await request(app()).get('/api/offers/not-an-offer');
    expect(res.status).toBe(404);
    expect(keysOf(res.body)).toEqual(['message']);
  });
});

// ---- helpers for the write tests --------------------------------------------------------------

/** An organiser's own upcoming event with one role of the given size, made through the real API. */
async function eventWithRole(me: TestOrganiser, headcount = 6) {
  const event = await request(app()).post('/api/events').set(me.auth).send({
    name: 'Offer test event', type: 'wedding', county: 'Kisumu', area: 'Milimani', venue: 'Hall',
    startsAt: inDays(80), endsAt: inDays(80, 20), expectedGuests: 100,
  });
  const role = await request(app()).post(`/api/events/${event.body.id}/roles`).set(me.auth).send({
    title: 'Waiters', category: 'catering', headcount, shiftStart: inDays(80, 8), shiftEnd: inDays(80, 21), payPerShift: 1500,
  });
  return { eventId: event.body.id as string, roleId: role.body.id as string };
}

const postOffer = (body: unknown) =>
  request(app()).post('/api/offers').set('Content-Type', 'application/json').send(JSON.stringify(body));
const offerCount = async (eventId: string) => (await (await getStore()).offers.listByEvent(eventId)).length;
const decide = (offerId: string, body: unknown, me?: TestOrganiser) => {
  const req = request(app()).patch(`/api/offers/${offerId}`).set('Content-Type', 'application/json');
  return (me ? req.set(me.auth) : req).send(JSON.stringify(body));
};
const roleOf = async (eventId: string, roleId: string) =>
  (await request(app()).get(`/api/events/${eventId}/roles`)).body.find((r: { id: string }) => r.id === roleId);

describe('POST /api/offers (K3)', () => {
  it('creates a pending offer and answers 201 with a Location and exactly the contract fields', async () => {
    const me = await newOrganiser(app());
    const { eventId, roleId } = await eventWithRole(me);
    const res = await postOffer({ roleId, workersOffered: 6, note: 'Six trained catering students' });
    expect(res.status).toBe(201);
    expect(keysOf(res.body)).toEqual(OFFER_KEYS);
    expect(res.body).toEqual({
      id: expect.stringMatching(/^ofr_\d+$/), roleId, eventId, workersOffered: 6,
      note: 'Six trained catering students', status: 'pending', createdAt: expect.stringMatching(ISO_DATE),
    });
    expect(res.headers['location']).toBe(`/api/offers/${res.body.id}`);
  });

  it('can be read back by Kazi and seen by the organiser, and does not fill the role yet', async () => {
    const me = await newOrganiser(app());
    const { eventId, roleId } = await eventWithRole(me);
    const created = (await postOffer({ roleId, workersOffered: 3, note: 'x' })).body;
    expect((await request(app()).get(`/api/offers/${created.id}`)).body).toEqual(created);
    expect((await request(app()).get(`/api/events/${eventId}/offers`).set(me.auth)).body).toEqual([created]);
    expect((await roleOf(eventId, roleId)).filled).toBe(0); // only an accepted offer fills places
  });

  it('treats the note as optional: missing means "", and it is trimmed', async () => {
    const me = await newOrganiser(app());
    const a = await eventWithRole(me);
    expect((await postOffer({ roleId: a.roleId, workersOffered: 1 })).body.note).toBe('');
    const b = await eventWithRole(me);
    expect((await postOffer({ roleId: b.roleId, workersOffered: 1, note: '  hello  ' })).body.note).toBe('hello');
    const c = await eventWithRole(me);
    expect((await postOffer({ roleId: c.roleId, workersOffered: 1, note: '' })).status).toBe(201);
    const d = await eventWithRole(me);
    expect((await postOffer({ roleId: d.roleId, workersOffered: 1, note: 'n'.repeat(500) })).status).toBe(201);
  });

  it('accepts exactly the open places, no more', async () => {
    const me = await newOrganiser(app());
    const { roleId } = await eventWithRole(me, 6);
    const tooMany = await postOffer({ roleId, workersOffered: 7 });
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.message).toBe(`workersOffered must be a whole number from 1 to the open slots (6 open on ${roleId})`);
    expect((await postOffer({ roleId, workersOffered: 6 })).status).toBe(201);
  });

  it('counts places other offers have already filled', async () => {
    const me = await newOrganiser(app());
    const { eventId, roleId } = await eventWithRole(me, 6);
    const first = (await postOffer({ roleId, workersOffered: 4 })).body;
    expect((await decide(first.id, { status: 'accepted' }, me)).status).toBe(200);
    expect((await postOffer({ roleId, workersOffered: 3 })).status).toBe(400); // only 2 open now
    expect((await postOffer({ roleId, workersOffered: 2 })).status).toBe(201);
    expect(await offerCount(eventId)).toBe(2);
  });

  it('works without a partner key for now (keys arrive in Week 9)', async () => {
    const me = await newOrganiser(app());
    const { roleId } = await eventWithRole(me);
    const res = await request(app()).post('/api/offers').send({ roleId, workersOffered: 1 });
    expect(res.status).toBe(201);
  });

  it('answers 404 { message } for a role that does not exist', async () => {
    const res = await postOffer({ roleId: 'rol_9999', workersOffered: 1 });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Role rol_9999 not found' });
    expect((await postOffer({ roleId: 'evt_2001', workersOffered: 1 })).status).toBe(404); // an event id is not a role id
  });

  it('answers 409 when the role is full', async () => {
    const me = await newOrganiser(app());
    const { eventId, roleId } = await eventWithRole(me, 2);
    const store = await getStore();
    await store.offers.decide((await store.offers.create({ role_id: roleId, event_id: eventId, workers_offered: 2, note: '' })).id, 'accepted');
    const res = await postOffer({ roleId, workersOffered: 1 });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ message: `Role ${roleId} is full` });
  });

  it('answers 409 when the event is no longer upcoming', async () => {
    const res = await postOffer({ roleId: 'rol_3011', workersOffered: 1 }); // a sample role on a completed event
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ message: 'Event evt_2007 is completed; only upcoming events accept offers' });
  });

  it('answers 409 for a second pending offer on the same role, until the first is decided', async () => {
    const me = await newOrganiser(app());
    const { eventId, roleId } = await eventWithRole(me);
    const first = (await postOffer({ roleId, workersOffered: 2 })).body;
    const dup = await postOffer({ roleId, workersOffered: 1 });
    expect(dup.status).toBe(409);
    expect(dup.body.message).toContain(`Role ${roleId} already has a pending offer`);
    expect(await offerCount(eventId)).toBe(1);

    await decide(first.id, { status: 'declined' }, me);
    expect((await postOffer({ roleId, workersOffered: 1 })).status).toBe(201); // open to offers again
  });

  it('lets exactly one of two simultaneous offers on a role through', async () => {
    const me = await newOrganiser(app());
    const { eventId, roleId } = await eventWithRole(me);
    const results = await Promise.all([postOffer({ roleId, workersOffered: 1 }), postOffer({ roleId, workersOffered: 1 })]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await offerCount(eventId)).toBe(1);
  });

  it.each([
    ['no roleId', { workersOffered: 1 }, 'roleId is required'],
    ['a blank roleId', { roleId: ' ', workersOffered: 1 }, 'roleId cannot be empty'],
    ['a roleId that is not text', { roleId: 3001, workersOffered: 1 }, 'roleId must be text'],
    ['no workersOffered', { roleId: 'ROLE' }, 'workersOffered must be a whole number from 1 to the open slots'],
    ['zero workers', { roleId: 'ROLE', workersOffered: 0 }, 'workersOffered must be a whole number from 1 to the open slots'],
    ['negative workers', { roleId: 'ROLE', workersOffered: -2 }, 'workersOffered must be a whole number from 1 to the open slots'],
    ['a fractional number of workers', { roleId: 'ROLE', workersOffered: 2.5 }, 'workersOffered must be a whole number'],
    ['workers sent as text', { roleId: 'ROLE', workersOffered: '3' }, 'workersOffered must be a whole number'],
    ['workers sent as null', { roleId: 'ROLE', workersOffered: null }, 'workersOffered must be a whole number'],
    ['a note that is not text', { roleId: 'ROLE', workersOffered: 1, note: 5 }, 'note must be text'],
    ['a null note', { roleId: 'ROLE', workersOffered: 1, note: null }, 'note is required'],
    ['a note over 500 characters', { roleId: 'ROLE', workersOffered: 1, note: 'n'.repeat(501) }, 'note must be at most 500'],
    ['an attempt to set the status', { roleId: 'ROLE', workersOffered: 1, status: 'accepted' }, 'Unknown field "status"'],
    ['an attempt to choose the event', { roleId: 'ROLE', workersOffered: 1, eventId: 'evt_2001' }, 'Unknown field "eventId"'],
    ['an array', [], 'must be a JSON object'],
  ])('answers 400 { message } for %s, and creates nothing', async (_label, body, text) => {
    const me = await newOrganiser(app());
    const { eventId, roleId } = await eventWithRole(me);
    const payload = Array.isArray(body) ? body : { ...body, ...(('roleId' in body && body.roleId === 'ROLE') ? { roleId } : {}) };
    const res = await postOffer(payload);
    expect(res.status).toBe(400);
    expect(keysOf(res.body)).toEqual(['message']);
    expect(res.body.message).toContain(text);
    expect(await offerCount(eventId)).toBe(0);
  });

  it('answers 400 for malformed or missing JSON and 413 for a body over 20 KB', async () => {
    expect((await request(app()).post('/api/offers').set('Content-Type', 'application/json').send('{"roleId":')).status).toBe(400);
    expect((await request(app()).post('/api/offers')).status).toBe(400);
    expect((await postOffer({ roleId: 'rol_3001', workersOffered: 1, note: 'x'.repeat(25_000) })).status).toBe(413);
  });
});

describe('DELETE /api/offers/{offerId} (K5)', () => {
  it('withdraws a pending offer: 204, no body, and it is gone', async () => {
    const me = await newOrganiser(app());
    const { eventId, roleId } = await eventWithRole(me);
    const offer = (await postOffer({ roleId, workersOffered: 2 })).body;
    const res = await request(app()).delete(`/api/offers/${offer.id}`);
    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    expect((await request(app()).get(`/api/offers/${offer.id}`)).status).toBe(404);
    expect((await request(app()).get(`/api/events/${eventId}/offers`).set(me.auth)).body).toEqual([]);
  });

  it('frees the role for a new offer', async () => {
    const me = await newOrganiser(app());
    const { roleId } = await eventWithRole(me);
    const offer = (await postOffer({ roleId, workersOffered: 2 })).body;
    expect((await postOffer({ roleId, workersOffered: 2 })).status).toBe(409);
    await request(app()).delete(`/api/offers/${offer.id}`);
    expect((await postOffer({ roleId, workersOffered: 2 })).status).toBe(201);
  });

  it('answers 404 for an unknown offer and for one already withdrawn', async () => {
    const missing = await request(app()).delete('/api/offers/ofr_9999');
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ message: 'Offer ofr_9999 not found' });

    const me = await newOrganiser(app());
    const { roleId } = await eventWithRole(me);
    const offer = (await postOffer({ roleId, workersOffered: 1 })).body;
    expect((await request(app()).delete(`/api/offers/${offer.id}`)).status).toBe(204);
    expect((await request(app()).delete(`/api/offers/${offer.id}`)).status).toBe(404);
  });

  it.each(['accepted', 'declined'] as const)('answers 409 for an offer that is already %s, and keeps it', async (status) => {
    const me = await newOrganiser(app());
    const { roleId } = await eventWithRole(me);
    const offer = (await postOffer({ roleId, workersOffered: 2 })).body;
    await decide(offer.id, { status }, me);
    const res = await request(app()).delete(`/api/offers/${offer.id}`);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ message: `Offer ${offer.id} is ${status}; only pending offers can be withdrawn` });
    expect((await request(app()).get(`/api/offers/${offer.id}`)).body.status).toBe(status);
  });

  it('works without a partner key for now (keys arrive in Week 9)', async () => {
    const me = await newOrganiser(app());
    const { roleId } = await eventWithRole(me);
    const offer = (await postOffer({ roleId, workersOffered: 1 })).body;
    expect((await request(app()).delete(`/api/offers/${offer.id}`)).status).toBe(204);
  });
});

describe('PATCH /api/offers/{offerId} (O3)', () => {
  it('accepting answers 200 with the new status and fills places on the role', async () => {
    const me = await newOrganiser(app());
    const { eventId, roleId } = await eventWithRole(me, 6);
    const offer = (await postOffer({ roleId, workersOffered: 4 })).body;
    const res = await decide(offer.id, { status: 'accepted' }, me);
    expect(res.status).toBe(200);
    expect(keysOf(res.body)).toEqual(OFFER_KEYS);
    expect(res.body).toEqual({ ...offer, status: 'accepted' });
    expect((await roleOf(eventId, roleId)).filled).toBe(4);
    expect((await request(app()).get(`/api/offers/${offer.id}`)).body.status).toBe('accepted'); // Kazi sees it
  });

  it('declining answers 200 and leaves the role alone', async () => {
    const me = await newOrganiser(app());
    const { eventId, roleId } = await eventWithRole(me);
    const offer = (await postOffer({ roleId, workersOffered: 4 })).body;
    const res = await decide(offer.id, { status: 'declined' }, me);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('declined');
    expect((await roleOf(eventId, roleId)).filled).toBe(0);
  });

  it('lets accepted offers fill a role completely, then a role shows as full to Kazi', async () => {
    const me = await newOrganiser(app());
    const { roleId } = await eventWithRole(me, 3);
    const a = (await postOffer({ roleId, workersOffered: 3 })).body;
    await decide(a.id, { status: 'accepted' }, me);
    const next = await postOffer({ roleId, workersOffered: 1 });
    expect(next.status).toBe(409);
    expect(next.body.message).toBe(`Role ${roleId} is full`);
  });

  it('answers 401 without a login, and changes nothing', async () => {
    const me = await newOrganiser(app());
    const { roleId } = await eventWithRole(me);
    const offer = (await postOffer({ roleId, workersOffered: 2 })).body;
    expect((await decide(offer.id, { status: 'accepted' })).status).toBe(401);
    expect((await request(app()).get(`/api/offers/${offer.id}`)).body.status).toBe('pending');
  });

  it('answers 403 for another organiser, and for the sample events nobody can log in as, changing nothing', async () => {
    const me = await newOrganiser(app());
    const stranger = await newOrganiser(app());
    const { eventId, roleId } = await eventWithRole(me);
    const offer = (await postOffer({ roleId, workersOffered: 2 })).body;

    const res = await decide(offer.id, { status: 'accepted' }, stranger);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ message: 'You can only decide offers on events you created.' });
    expect((await request(app()).get(`/api/offers/${offer.id}`)).body.status).toBe('pending');
    expect((await roleOf(eventId, roleId)).filled).toBe(0);

    const store = await getStore();
    const sample = await store.offers.create({ role_id: 'rol_3006', event_id: 'evt_2003', workers_offered: 1, note: '' });
    expect((await decide(sample.id, { status: 'accepted' }, me)).status).toBe(403);
  });

  it('answers 404 for an unknown offer', async () => {
    const me = await newOrganiser(app());
    const res = await decide('ofr_9999', { status: 'accepted' }, me);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Offer ofr_9999 not found' });
  });

  it.each([
    ['status pending', { status: 'pending' }, 'status must be one of accepted, declined'],
    ['an unknown status', { status: 'approved' }, 'status must be one of accepted, declined'],
    ['a status in the wrong case', { status: 'Accepted' }, 'status must be one of'],
    ['no status', {}, 'status is required'],
    ['a status that is not text', { status: true }, 'status must be one of'],
    ['an extra field', { status: 'accepted', workersOffered: 99 }, 'Unknown field "workersOffered"'],
    ['an array', [], 'must be a JSON object'],
  ])('answers 400 { message } for %s, and changes nothing', async (_label, body, text) => {
    const me = await newOrganiser(app());
    const { roleId } = await eventWithRole(me);
    const offer = (await postOffer({ roleId, workersOffered: 2 })).body;
    const res = await decide(offer.id, body, me);
    expect(res.status).toBe(400);
    expect(res.body.message).toContain(text);
    expect((await request(app()).get(`/api/offers/${offer.id}`)).body.status).toBe('pending');
  });

  it('answers 409 for a decided offer: accepted and declined are final', async () => {
    const me = await newOrganiser(app());
    const { eventId, roleId } = await eventWithRole(me, 6);
    const offer = (await postOffer({ roleId, workersOffered: 2 })).body;
    await decide(offer.id, { status: 'accepted' }, me);
    for (const status of ['accepted', 'declined']) {
      const res = await decide(offer.id, { status }, me);
      expect(res.status).toBe(409);
      expect(res.body).toEqual({ message: `Offer ${offer.id} is already accepted; accepted and declined are final` });
    }
    expect((await roleOf(eventId, roleId)).filled).toBe(2); // accepted once, counted once
  });

  it('answers 409 when accepting would overfill the role, and leaves the offer pending', async () => {
    const me = await newOrganiser(app());
    const { eventId, roleId } = await eventWithRole(me, 3);
    const store = await getStore();
    // two offers on one role cannot be pending together through the API, so seed the second directly
    const a = await store.offers.create({ role_id: roleId, event_id: eventId, workers_offered: 2, note: '' });
    await store.offers.decide(a.id, 'accepted');
    const b = await store.offers.create({ role_id: roleId, event_id: eventId, workers_offered: 2, note: '' });
    const res = await decide(b.id, { status: 'accepted' }, me);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ message: `Role ${roleId} has 1 open place, fewer than the 2 offered` });
    expect((await request(app()).get(`/api/offers/${b.id}`)).body.status).toBe('pending');
    expect((await roleOf(eventId, roleId)).filled).toBe(2);
    expect((await decide(b.id, { status: 'declined' }, me)).status).toBe(200); // it can still be declined
  });

  it('answers 409 when the event is no longer upcoming', async () => {
    const me = await newOrganiser(app());
    const store = await getStore();
    // finishing an event has no API yet, so build one that is the organiser's but already completed
    const done = await store.events.create({
      organiser_id: me.id, name: 'Already over', type: 'other', county: 'Kisumu', area: 'Milimani', venue: 'Hall',
      starts_at: new Date('2026-01-10T10:00:00Z'), ends_at: new Date('2026-01-10T12:00:00Z'), expected_guests: 10,
      status: 'completed',
    });
    const role = await store.roles.create({
      event_id: done.id, title: 'T', category: 'catering', headcount: 2, filled: 0,
      shift_start: new Date('2026-01-10T09:00:00Z'), shift_end: new Date('2026-01-10T13:00:00Z'), pay_per_shift: 1,
    });
    const offer = await store.offers.create({ role_id: role.id, event_id: done.id, workers_offered: 1, note: '' });

    const res = await decide(offer.id, { status: 'accepted' }, me);
    expect(res.status).toBe(409);
    expect(res.body.message).toBe(`Event ${done.id} is completed; its offers can no longer be decided`);
    expect((await request(app()).get(`/api/offers/${offer.id}`)).body.status).toBe('pending');
  });

  it('lets only one of two simultaneous decisions on an offer through', async () => {
    const me = await newOrganiser(app());
    const { eventId, roleId } = await eventWithRole(me, 6);
    const offer = (await postOffer({ roleId, workersOffered: 4 })).body;
    const results = await Promise.all([decide(offer.id, { status: 'accepted' }, me), decide(offer.id, { status: 'accepted' }, me)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await roleOf(eventId, roleId)).filled).toBe(4); // not 8
  });

  it('checks the login first, then the offer, then the owner, then the body', async () => {
    const me = await newOrganiser(app());
    const stranger = await newOrganiser(app());
    const { roleId } = await eventWithRole(me);
    const offer = (await postOffer({ roleId, workersOffered: 1 })).body;
    expect((await decide(offer.id, 'not even an object')).status).toBe(401);
    expect((await decide('ofr_9999', { nonsense: 1 }, me)).status).toBe(404);
    expect((await decide(offer.id, { nonsense: 1 }, stranger)).status).toBe(403);
    expect((await decide(offer.id, { nonsense: 1 }, me)).status).toBe(400);
  });
});
