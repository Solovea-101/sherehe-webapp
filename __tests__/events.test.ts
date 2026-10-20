import request from 'supertest';
import { getStore } from '@/lib/db';
import type { ApiEvent } from '@/lib/mappers';
import { useTestServer } from './helpers/server';
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
