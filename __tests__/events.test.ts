import request from 'supertest';
import { getStore } from '@/lib/db';
import type { ApiEvent } from '@/lib/mappers';
import { useTestServer } from './helpers/server';
import { newOrganiser } from './helpers/auth';
import { inDays } from './helpers/dates';
import { EVENT_KEYS, ISO_DATE, keysOf } from './helpers/shapes';

const app = useTestServer();

const WANJIKU_WEDDING: ApiEvent = {
  id: 'evt_2001',
  name: 'Wanjiku and Otieno wedding',
  type: 'wedding',
  county: 'Nairobi',
  area: 'Westlands',
  venue: 'Sarit Expo Centre',
  startsAt: '2026-12-05T14:00:00Z',
  endsAt: '2026-12-05T22:00:00Z',
  expectedGuests: 300,
  status: 'upcoming',
};

describe('GET /api/events?status=upcoming (K1)', () => {
  it('lists upcoming events as a bare array, soonest first, without finished events', async () => {
    const res = await request(app()).get('/api/events?status=upcoming');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(Array.isArray(res.body)).toBe(true);

    const events: ApiEvent[] = res.body;
    expect(events.length).toBeGreaterThanOrEqual(6);
    expect(events.every((e) => e.status === 'upcoming')).toBe(true);
    expect(events.find((e) => e.id === 'evt_2007')).toBeUndefined(); // completed
    const starts = events.map((e) => e.startsAt);
    expect(starts).toEqual([...starts].sort());
  });

  it('returns exactly the contract fields, with ISO dates and whole numbers', async () => {
    const res = await request(app()).get('/api/events?status=upcoming');
    for (const event of res.body as ApiEvent[]) {
      expect(keysOf(event)).toEqual(EVENT_KEYS);
      expect(event.startsAt).toMatch(ISO_DATE);
      expect(event.endsAt).toMatch(ISO_DATE);
      expect(Number.isInteger(event.expectedGuests)).toBe(true);
    }
  });

  it('matches the README example for evt_2001', async () => {
    const res = await request(app()).get('/api/events?status=upcoming&county=Nairobi');
    expect(res.body.find((e: ApiEvent) => e.id === 'evt_2001')).toEqual(WANJIKU_WEDDING);
  });

  it('filters by county ignoring letter case', async () => {
    const [lower, upper, title] = await Promise.all(
      ['nairobi', 'NAIROBI', 'Nairobi'].map((c) => request(app()).get(`/api/events?status=upcoming&county=${c}`)),
    );
    expect(lower.status).toBe(200);
    expect(lower.body.length).toBeGreaterThan(0);
    expect(lower.body.every((e: ApiEvent) => e.county === 'Nairobi')).toBe(true);
    expect(upper.body).toEqual(lower.body);
    expect(title.body).toEqual(lower.body);
  });

  it('finds Kazi’s other seed areas in their own counties', async () => {
    const mombasa = await request(app()).get('/api/events?status=upcoming&county=Mombasa');
    expect(mombasa.body.map((e: ApiEvent) => e.area)).toEqual(['Nyali']);
    const kiambu = await request(app()).get('/api/events?status=upcoming&county=kiambu');
    expect(kiambu.body.map((e: ApiEvent) => e.area)).toEqual(['Ruaka']);
  });

  it('answers 200 with [] for a real county that has no upcoming events', async () => {
    const res = await request(app()).get('/api/events?status=upcoming&county=Turkana');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('treats a blank county as "every county"', async () => {
    const all = await request(app()).get('/api/events?status=upcoming');
    const blank = await request(app()).get('/api/events?status=upcoming&county=');
    const spaces = await request(app()).get('/api/events?status=upcoming&county=%20%20');
    expect(blank.body).toEqual(all.body);
    expect(spaces.body).toEqual(all.body);
  });

  it('ignores parameters it does not know', async () => {
    const all = await request(app()).get('/api/events?status=upcoming');
    const extra = await request(app()).get('/api/events?status=upcoming&page=2&sort=name');
    expect(extra.status).toBe(200);
    expect(extra.body).toEqual(all.body);
  });

  it.each([
    ['status is missing', '/api/events', 'status is required'],
    ['status is blank', '/api/events?status=', 'status is required'],
    ['status is not upcoming', '/api/events?status=completed', 'status must be upcoming'],
    ['status has the wrong case', '/api/events?status=Upcoming', 'status must be upcoming'],
    ['status is repeated', '/api/events?status=upcoming&status=upcoming', 'status can be given only once'],
    ['county is not a Kenyan county', '/api/events?status=upcoming&county=Narnia', '47 counties'],
    ['county is repeated', '/api/events?status=upcoming&county=Nairobi&county=Kiambu', 'county can be given only once'],
  ])('answers 400 { message } when %s', async (_label, url, text) => {
    const res = await request(app()).get(url);
    expect(res.status).toBe(400);
    expect(keysOf(res.body)).toEqual(['message']);
    expect(res.body.message).toContain(text);
  });

  it('shows an event created after the server started, in start-time order', async () => {
    const store = await getStore();
    const created = await store.events.create({
      organiser_id: 'usr_1001', name: 'Edge case gala', type: 'other', county: 'Kisumu', area: 'Milimani',
      venue: 'Lakeside Hall', starts_at: new Date('2026-10-30T09:15:00.789Z'), // sub-second part must not leak
      ends_at: new Date('2026-10-30T12:00:00Z'), expected_guests: 40, status: 'upcoming',
    });

    const res = await request(app()).get('/api/events?status=upcoming');
    expect(res.body[0]).toMatchObject({ id: created.id, startsAt: '2026-10-30T09:15:00Z' });

    const kisumu = await request(app()).get('/api/events?status=upcoming&county=KISUMU');
    expect(kisumu.body.map((e: ApiEvent) => e.id)).toEqual([created.id]);
  });

  it('adds CORS headers', async () => {
    const res = await request(app()).get('/api/events?status=upcoming');
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });
});

describe('GET /api/events/{eventId} (K1)', () => {
  it('returns one event with exactly the contract fields', async () => {
    const res = await request(app()).get('/api/events/evt_2001');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(WANJIKU_WEDDING);
    expect(keysOf(res.body)).toEqual(EVENT_KEYS);
  });

  it('returns the same event the list does', async () => {
    const list = await request(app()).get('/api/events?status=upcoming&county=Mombasa');
    const one = await request(app()).get(`/api/events/${list.body[0].id}`);
    expect(one.body).toEqual(list.body[0]);
  });

  it('still returns an event that is over, with its status', async () => {
    const res = await request(app()).get('/api/events/evt_2007');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 'evt_2007', status: 'completed', area: 'South B' });
  });

  it('answers 404 { message } for an unknown id', async () => {
    const res = await request(app()).get('/api/events/evt_9999');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Event evt_9999 not found' });
  });

  it.each([['not-an-id'], ['EVT_2001'], ['2001'], ['evt_2001%20']])('answers 404 for the malformed id %s', async (id) => {
    const res = await request(app()).get(`/api/events/${id}`);
    expect(res.status).toBe(404);
    expect(keysOf(res.body)).toEqual(['message']);
  });

  it('keeps the message short for an absurdly long id', async () => {
    const res = await request(app()).get(`/api/events/${'x'.repeat(5000)}`);
    expect(res.status).toBe(404);
    expect(res.body.message.length).toBeLessThan(100);
  });
});

describe('POST /api/events (O2)', () => {
  const newEvent = () => ({
    name: 'Njeri and Kamau wedding', type: 'wedding', county: 'Nairobi', area: 'Kilimani', venue: 'Kilimani Gardens',
    startsAt: inDays(60), endsAt: inDays(60, 18), expectedGuests: 200,
  });
  const post = (body: unknown, auth?: { Authorization: string }) => {
    const req = request(app()).post('/api/events').set('Content-Type', 'application/json');
    return (auth ? req.set(auth) : req).send(JSON.stringify(body));
  };

  it('creates an upcoming event owned by the logged-in organiser', async () => {
    const me = await newOrganiser(app());
    const body = newEvent();
    const res = await post(body, me.auth);
    expect(res.status).toBe(201);
    expect(keysOf(res.body)).toEqual(EVENT_KEYS);
    expect(res.body).toMatchObject({ ...body, status: 'upcoming' });
    expect(res.body.id).toMatch(/^evt_\d+$/);
    expect(res.headers['location']).toBe(`/api/events/${res.body.id}`);
    expect(res.body.startsAt).toMatch(ISO_DATE);

    const store = await getStore();
    expect((await store.events.get(res.body.id))?.organiser_id).toBe(me.id);
  });

  it('shows up in the partner reads straight away', async () => {
    const me = await newOrganiser(app());
    const created = (await post({ ...newEvent(), county: 'Nakuru', area: 'Milimani' }, me.auth)).body;
    expect((await request(app()).get(`/api/events/${created.id}`)).body).toEqual(created);
    const list = await request(app()).get('/api/events?status=upcoming&county=nakuru');
    expect(list.body).toEqual([created]);
    expect((await request(app()).get(`/api/events/${created.id}/roles`)).body).toEqual([]);
  });

  it('stores the county in its official spelling and trims text', async () => {
    const me = await newOrganiser(app());
    const res = await post({ ...newEvent(), county: ' uasin gishu ', name: '  Eldoret Expo  ', venue: ' Hall ' }, me.auth);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ county: 'Uasin Gishu', name: 'Eldoret Expo', venue: 'Hall' });
  });

  it('accepts each event type and the extreme guest counts', async () => {
    const me = await newOrganiser(app());
    for (const type of ['wedding', 'conference', 'concert', 'corporate', 'other']) {
      expect((await post({ ...newEvent(), type }, me.auth)).status).toBe(201);
    }
    expect((await post({ ...newEvent(), expectedGuests: 1 }, me.auth)).status).toBe(201);
    expect((await post({ ...newEvent(), expectedGuests: 100_000 }, me.auth)).status).toBe(201);
  });

  it('answers 401 without a valid login, and creates nothing', async () => {
    const before = (await request(app()).get('/api/events?status=upcoming')).body.length;
    expect((await post(newEvent())).status).toBe(401);
    expect((await post(newEvent(), { Authorization: 'Bearer ' + 'a'.repeat(43) })).status).toBe(401);
    expect((await request(app()).get('/api/events?status=upcoming')).body).toHaveLength(before);
  });

  it.each([
    ['a missing name', (e: object) => ({ ...e, name: undefined }), 'name is required'],
    ['a blank name', (e: object) => ({ ...e, name: '   ' }), 'name cannot be empty'],
    ['a name over 120 characters', (e: object) => ({ ...e, name: 'x'.repeat(121) }), 'at most 120'],
    ['a name that is not text', (e: object) => ({ ...e, name: 42 }), 'name must be text'],
    ['an unknown type', (e: object) => ({ ...e, type: 'festival' }), 'type must be one of wedding, conference'],
    ['a type in the wrong case', (e: object) => ({ ...e, type: 'Wedding' }), 'type must be one of'],
    ['a missing county', (e: object) => ({ ...e, county: undefined }), 'county is required'],
    ['a county that does not exist', (e: object) => ({ ...e, county: 'Narnia' }), '47 counties'],
    ['a blank area', (e: object) => ({ ...e, area: '' }), 'area cannot be empty'],
    ['a venue over 120 characters', (e: object) => ({ ...e, venue: 'v'.repeat(121) }), 'venue must be at most 120'],
    ['a start date in the past', (e: object) => ({ ...e, startsAt: '2020-01-01T10:00:00Z' }), 'startsAt must be in the future'],
    ['a start date with milliseconds', (e: object) => ({ ...e, startsAt: inDays(60).replace('Z', '.000Z') }), 'startsAt must be an ISO 8601 UTC'],
    ['a start date with an offset', (e: object) => ({ ...e, startsAt: '2030-01-01T10:00:00+03:00' }), 'startsAt must be an ISO 8601 UTC'],
    ['a start date that is not a date', (e: object) => ({ ...e, startsAt: 'next friday' }), 'startsAt must be an ISO 8601 UTC'],
    ['an end before the start', (e: object) => ({ ...e, endsAt: inDays(59) }), 'endsAt must be after startsAt'],
    ['an end equal to the start', (e: object) => ({ ...e, endsAt: inDays(60) }), 'endsAt must be after startsAt'],
    ['no end date', (e: object) => ({ ...e, endsAt: undefined }), 'endsAt is required'],
    ['zero guests', (e: object) => ({ ...e, expectedGuests: 0 }), 'expectedGuests must be a whole number from 1 to 100000'],
    ['too many guests', (e: object) => ({ ...e, expectedGuests: 100_001 }), 'expectedGuests must be a whole number'],
    ['a fractional guest count', (e: object) => ({ ...e, expectedGuests: 12.5 }), 'expectedGuests must be a whole number'],
    ['guests sent as text', (e: object) => ({ ...e, expectedGuests: '200' }), 'expectedGuests must be a whole number'],
    ['an unknown field', (e: object) => ({ ...e, decorations: 'balloons' }), 'Unknown field "decorations"'],
    ['an attempt to set the status', (e: object) => ({ ...e, status: 'completed' }), 'Unknown field "status"'],
    ['an attempt to set the organiser', (e: object) => ({ ...e, organiserId: 'usr_1001' }), 'Unknown field "organiserId"'],
    ['an attempt to choose the id', (e: object) => ({ ...e, id: 'evt_1' }), 'Unknown field "id"'],
  ])('answers 400 { message } for %s, and creates nothing', async (_label, mutate, text) => {
    const me = await newOrganiser(app());
    const store = await getStore();
    const before = (await store.events.list()).length;
    const res = await post(mutate(newEvent()), me.auth);
    expect(res.status).toBe(400);
    expect(keysOf(res.body)).toEqual(['message']);
    expect(res.body.message).toContain(text);
    expect(await store.events.list()).toHaveLength(before);
  });

  it('answers 400 for bodies that are not objects or not JSON, and 413 when too large', async () => {
    const me = await newOrganiser(app());
    for (const body of [[], 'text', null, 7]) expect((await post(body, me.auth)).status).toBe(400);
    const bad = await request(app()).post('/api/events').set(me.auth).set('Content-Type', 'application/json').send('{"name":');
    expect(bad.status).toBe(400);
    expect((await request(app()).post('/api/events').set(me.auth)).status).toBe(400); // no body
    expect((await post({ ...newEvent(), name: 'x'.repeat(25_000) }, me.auth)).status).toBe(413);
  });

  it('checks the login before reading the body', async () => {
    const res = await request(app()).post('/api/events').set('Content-Type', 'application/json').send('{"name":');
    expect(res.status).toBe(401);
  });
});
