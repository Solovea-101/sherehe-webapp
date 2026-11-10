import request from 'supertest';
import { getStore } from '@/lib/db';
import { newOrganiser } from './helpers/auth';
import { inDays } from './helpers/dates';
import { useTestServer } from './helpers/server';
import { ISO_DATE, keysOf } from './helpers/shapes';
import { organiserWithEvent, useUjuziStub } from './helpers/ujuziWorld';

const app = useTestServer();
const ujuzi = useUjuziStub();

const TRAINING_KEYS = ['courseId', 'createdAt', 'crewSize', 'eventId', 'id', 'preferredStart', 'status'].sort();
const OPTION_KEYS = ['area', 'category', 'centreName', 'certificateLevel', 'courseId', 'county', 'durationWeeks', 'feeKes', 'nextStart', 'title'].sort();

type Me = Awaited<ReturnType<typeof organiserWithEvent>>;
const book = (me: Me, body: object = {}) =>
  request(app()).post('/api/crew-trainings').set(me.auth).send({
    eventId: me.eventId, courseId: 'crs_501', crewSize: 6, preferredStart: inDays(30), ...body,
  });

describe('GET /api/training-options (O4, S1)', () => {
  it('lists Ujuzi’s courses in Sherehe’s own shape, without Ujuzi’s internal ids', async () => {
    const me = await newOrganiser(app());
    const res = await request(app()).get('/api/training-options').set(me.auth);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(4);
    expect(res.body[0]).toEqual({
      courseId: 'crs_501', title: 'Food hygiene and event service', category: 'catering', centreName: 'Westlands Skills Centre',
      county: 'Nairobi', area: 'Westlands', durationWeeks: 2, feeKes: 3500, nextStart: '2026-11-23T07:00:00Z', certificateLevel: 'short-course',
    });
    for (const option of res.body) {
      expect(keysOf(option)).toEqual(OPTION_KEYS);
      expect(option.nextStart).toMatch(ISO_DATE);
    }
    expect(JSON.stringify(res.body)).not.toContain('cen_11'); // the centre's id stays at Ujuzi
  });

  it('filters by category and county, in any letter case, and answers [] when nothing matches', async () => {
    const me = await newOrganiser(app());
    const get = (qs: string) => request(app()).get(`/api/training-options${qs}`).set(me.auth);
    expect((await get('?category=security')).body.map((o: { courseId: string }) => o.courseId)).toEqual(['crs_502']);
    expect((await get('?county=MOMBASA')).body.map((o: { courseId: string }) => o.courseId)).toEqual(['crs_503']);
    expect((await get('?category=catering&county=nairobi')).body.map((o: { courseId: string }) => o.courseId)).toEqual(['crs_501']);
    expect((await get('?category=plumbing')).body).toEqual([]);
    expect((await get('?category=catering&county=Mombasa')).body).toEqual([]);
  });

  it('treats blank filters as "any" and ignores parameters it does not know', async () => {
    const me = await newOrganiser(app());
    const all = (await request(app()).get('/api/training-options').set(me.auth)).body;
    expect((await request(app()).get('/api/training-options?category=&county=%20').set(me.auth)).body).toEqual(all);
    expect((await request(app()).get('/api/training-options?page=2').set(me.auth)).body).toEqual(all);
  });

  it.each([
    ['a category outside the shared list', '?category=baking', 'category must be one of accommodation'],
    ['a category in the wrong case', '?category=Catering', 'category must be one of'],
    ['a county that does not exist', '?county=Narnia', '47 counties'],
    ['a category given twice', '?category=catering&category=security', 'category can be given only once'],
    ['a county given twice', '?county=Nairobi&county=Kiambu', 'county can be given only once'],
  ])('answers 400 { message } for %s, without calling Ujuzi', async (_label, qs, text) => {
    const me = await newOrganiser(app());
    const res = await request(app()).get(`/api/training-options${qs}`).set(me.auth);
    expect(res.status).toBe(400);
    expect(res.body.message).toContain(text);
    expect(ujuzi().calls).toHaveLength(0);
  });

  it('answers 401 without a login, without calling Ujuzi', async () => {
    expect((await request(app()).get('/api/training-options')).status).toBe(401);
    expect(ujuzi().calls).toHaveLength(0);
  });

  it('asks Ujuzi once for the same question within 5 minutes', async () => {
    const me = await newOrganiser(app());
    await request(app()).get('/api/training-options?category=catering').set(me.auth);
    await request(app()).get('/api/training-options?category=catering').set(me.auth);
    expect(ujuzi().calls).toHaveLength(1);
  });

  it('sends our Ujuzi key, and answers our own 502 if Ujuzi refuses it', async () => {
    const me = await newOrganiser(app());
    ujuzi().requireKey = 'ujuzi-issued-key';
    process.env.UJUZI_API_KEY = 'wrong';
    const refused = await request(app()).get('/api/training-options').set(me.auth);
    expect(refused.status).toBe(502);
    expect(JSON.stringify(refused.body)).not.toContain('wrong');
    process.env.UJUZI_API_KEY = 'ujuzi-issued-key';
    expect((await request(app()).get('/api/training-options').set(me.auth)).status).toBe(200);
  });
});

describe('GET /api/training-options when Ujuzi stops answering (Week 11: a saved copy, flagged)', () => {
  const ISO_UTC_NO_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
  const later = (ms: number) => {
    const real = Date.now.bind(Date);
    jest.spyOn(Date, 'now').mockImplementation(() => real() + ms);
  };
  beforeEach(() => jest.spyOn(console, 'warn').mockImplementation(() => undefined));
  afterEach(() => jest.restoreAllMocks()); // the shifted clock must not leak into the tests after these

  it('sends the last good list as a bare array with X-Data-Stale and X-Data-As-Of, once the 5-minute memory has expired', async () => {
    const me = await newOrganiser(app());
    const fresh = await request(app()).get('/api/training-options?category=catering').set(me.auth);
    expect(fresh.status).toBe(200);
    expect(fresh.headers['x-data-stale']).toBeUndefined(); // a live answer carries neither header
    expect(fresh.headers['x-data-as-of']).toBeUndefined();

    later(6 * 60 * 1000);
    ujuzi().mode = 'down';
    const saved = await request(app()).get('/api/training-options?category=catering').set(me.auth);
    expect(saved.status).toBe(200);
    expect(Array.isArray(saved.body)).toBe(true); // the body stays a bare array, as in every other list
    expect(saved.body).toEqual(fresh.body);
    expect(saved.headers['x-data-stale']).toBe('true');
    expect(saved.headers['x-data-as-of']).toMatch(ISO_UTC_NO_MS);
    expect(Date.parse(saved.headers['x-data-as-of'])).toBeLessThanOrEqual(Date.now());
  });

  it('is live again as soon as Ujuzi is back, with neither header', async () => {
    const me = await newOrganiser(app());
    await request(app()).get('/api/training-options?category=catering').set(me.auth);
    later(6 * 60 * 1000);
    ujuzi().mode = 'down';
    expect((await request(app()).get('/api/training-options?category=catering').set(me.auth)).headers['x-data-stale']).toBe('true');
    ujuzi().mode = 'ok';
    const back = await request(app()).get('/api/training-options?category=catering').set(me.auth);
    expect(back.status).toBe(200);
    expect(back.headers['x-data-stale']).toBeUndefined();
  });

  it('answers our own 502 when nothing has ever been saved for that question, with no stale headers', async () => {
    const me = await newOrganiser(app());
    ujuzi().mode = 'down';
    const res = await request(app()).get('/api/training-options?category=security').set(me.auth);
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ message: 'Ujuzi is not responding right now. Try again in a minute.' });
    expect(res.headers['x-data-stale']).toBeUndefined();
  });

  it('answers our own 502 for a copy older than an hour', async () => {
    const me = await newOrganiser(app());
    await request(app()).get('/api/training-options').set(me.auth);
    later(61 * 60 * 1000);
    ujuzi().mode = 'down';
    expect((await request(app()).get('/api/training-options').set(me.auth)).status).toBe(502);
  });

  it('never saves a certificate check: with Ujuzi down it is our 502 even right after a good one', async () => {
    const me = await newOrganiser(app());
    const good = await request(app()).post('/api/certificate-checks').set(me.auth).send({ certificateNo: 'UJZ-2026-00123' });
    expect(good.status).toBe(201);
    ujuzi().mode = 'down';
    const again = await request(app()).post('/api/certificate-checks').set(me.auth).send({ certificateNo: 'UJZ-2026-00123' });
    expect(again.status).toBe(502);
    expect(again.headers['x-data-stale']).toBeUndefined();
  });

  it('lets a browser page read the two headers (CORS exposes them)', async () => {
    const me = await newOrganiser(app());
    const res = await request(app()).get('/api/training-options').set(me.auth);
    const exposed = String(res.headers['access-control-expose-headers']).toLowerCase();
    expect(exposed).toContain('x-data-stale');
    expect(exposed).toContain('x-data-as-of');
  });
});

describe('POST /api/crew-trainings (O4, S3)', () => {
  it('books at Ujuzi and records it: 201, Location, our own id, status pending', async () => {
    const me = await organiserWithEvent(app());
    const res = await book(me);
    expect(res.status).toBe(201);
    expect(keysOf(res.body)).toEqual(TRAINING_KEYS);
    expect(res.body).toMatchObject({ eventId: me.eventId, courseId: 'crs_501', crewSize: 6, status: 'pending' });
    expect(res.body.id).toMatch(/^trn_\d+$/);
    expect(res.body.createdAt).toMatch(ISO_DATE);
    expect(res.headers['location']).toBe(`/api/crew-trainings/${res.body.id}`);

    // Ujuzi's booking exists, named after our event, and its id is not shown to our clients
    expect([...ujuzi().bookings.values()]).toEqual([
      expect.objectContaining({ courseId: 'crs_501', crewSize: 6, eventName: 'Wanjiku and Otieno wedding', status: 'pending' }),
    ]);
    expect(JSON.stringify(res.body)).not.toContain('bkg_');
  });

  it('shows up in the organiser’s list and by id, with the same content', async () => {
    const me = await organiserWithEvent(app());
    const created = (await book(me)).body;
    expect((await request(app()).get('/api/crew-trainings').set(me.auth)).body).toEqual([created]);
    expect((await request(app()).get(`/api/crew-trainings/${created.id}`).set(me.auth)).body).toEqual(created);
  });

  it('answers 401 without a login, without calling Ujuzi', async () => {
    const me = await organiserWithEvent(app());
    const res = await request(app()).post('/api/crew-trainings').send({ eventId: me.eventId, courseId: 'crs_501', crewSize: 6, preferredStart: inDays(30) });
    expect(res.status).toBe(401);
    expect(ujuzi().calls).toHaveLength(0);
  });

  it.each([
    ['no eventId', { eventId: undefined }, 'eventId is required'],
    ['no courseId', { courseId: undefined }, 'courseId is required'],
    ['a blank courseId', { courseId: '  ' }, 'courseId cannot be empty'],
    ['a crew of 0', { crewSize: 0 }, 'crewSize must be a whole number from 1 to 40'],
    ['a crew of 41', { crewSize: 41 }, 'crewSize must be a whole number from 1 to 40'],
    ['a fractional crew', { crewSize: 2.5 }, 'crewSize must be a whole number'],
    ['a crew sent as text', { crewSize: '6' }, 'crewSize must be a whole number'],
    ['a start in the past', { preferredStart: '2020-01-01T08:00:00Z' }, 'preferredStart must be in the future'],
    ['a start with milliseconds', { preferredStart: inDays(30).replace('Z', '.000Z') }, 'preferredStart must be an ISO 8601 UTC'],
    ['a start not before the event', { preferredStart: inDays(61) }, 'preferredStart must be before the event starts'],
    ['an attempt to set the status', { status: 'confirmed' }, 'Unknown field "status"'],
    ['an attempt to choose Ujuzi’s booking id', { ujuziBookingId: 'bkg_1' }, 'Unknown field "ujuziBookingId"'],
  ])('answers 400 { message } for %s, without calling Ujuzi or recording anything', async (_label, change, text) => {
    const me = await organiserWithEvent(app());
    const res = await book(me, change);
    expect(res.status).toBe(400);
    expect(keysOf(res.body)).toEqual(['message']);
    expect(res.body.message).toContain(text);
    expect(ujuzi().calls).toHaveLength(0);
    expect((await request(app()).get('/api/crew-trainings').set(me.auth)).body).toEqual([]);
  });

  it('answers 404 for an event that does not exist, 403 for someone else’s, 409 once it is over', async () => {
    const me = await organiserWithEvent(app());
    const other = await organiserWithEvent(app());

    const missing = await book(me, { eventId: 'evt_9999' });
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ message: 'Event evt_9999 not found' });

    const forbidden = await book(me, { eventId: other.eventId });
    expect(forbidden.status).toBe(403);
    expect(forbidden.body).toEqual({ message: 'You can only book training for events you created.' });
    expect((await book(me, { eventId: 'evt_2001' })).status).toBe(403); // a sample event

    const store = await getStore();
    const done = await store.events.create({
      organiser_id: me.id, name: 'Over', type: 'other', county: 'Nairobi', area: 'Westlands', venue: 'Hall',
      starts_at: new Date('2026-01-10T10:00:00Z'), ends_at: new Date('2026-01-10T12:00:00Z'), expected_guests: 5, status: 'completed',
    });
    const over = await book(me, { eventId: done.id });
    expect(over.status).toBe(409);
    expect(over.body.message).toBe(`Event ${done.id} is completed; training can only be booked for upcoming events`);

    expect(ujuzi().calls).toHaveLength(0);
  });

  it('answers 404 { message } for a course Ujuzi does not have, and records nothing', async () => {
    const me = await organiserWithEvent(app());
    const res = await book(me, { courseId: 'crs_999' });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Course crs_999 not found' });
    expect((await request(app()).get('/api/crew-trainings').set(me.auth)).body).toEqual([]);
    expect(ujuzi().bookings.size).toBe(0);
  });

  it('takes the booking back from Ujuzi if it cannot be recorded here', async () => {
    const me = await organiserWithEvent(app());
    const store = await getStore();
    const failing = jest.spyOn(store.crewTrainings, 'create').mockRejectedValueOnce(new Error('disk full'));
    const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await book(me);
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('disk full');
    expect(ujuzi().bookings.size).toBe(0); // cancelled again, so nobody is billed for a booking nobody can see
    failing.mockRestore();
    log.mockRestore();
    expect((await request(app()).get('/api/crew-trainings').set(me.auth)).body).toEqual([]);
  });

  it('logs loudly if the booking can be neither recorded nor cancelled', async () => {
    const me = await organiserWithEvent(app());
    const store = await getStore();
    const failing = jest.spyOn(store.crewTrainings, 'create').mockImplementationOnce(async () => {
      ujuzi().mode = 'down'; // Ujuzi dies between the booking and the cancel
      throw new Error('disk full');
    });
    const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await book(me);
    expect(res.status).toBe(500);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/ORPHANED BOOKING: Ujuzi booking bkg_\d+/), expect.anything());
    failing.mockRestore();
    log.mockRestore();
  });
});

describe('GET /api/crew-trainings and /api/crew-trainings/{id} (O4, S4)', () => {
  it('lists only the organiser’s own, newest first, and [] when there are none', async () => {
    const me = await organiserWithEvent(app());
    const other = await organiserWithEvent(app());
    expect((await request(app()).get('/api/crew-trainings').set(me.auth)).body).toEqual([]);
    const a = (await book(me)).body;
    const b = (await book(me, { courseId: 'crs_502', crewSize: 3 })).body; // another course: Ujuzi refuses a second pending booking of the same course for one event
    await book(other);
    const list = (await request(app()).get('/api/crew-trainings').set(me.auth)).body;
    expect(list.map((t: { id: string }) => t.id)).toEqual([b.id, a.id]);
  });

  it('answers 409 when the event already has a pending booking of that course at Ujuzi', async () => {
    const me = await organiserWithEvent(app());
    expect((await book(me)).status).toBe(201);
    const again = await book(me);
    expect(again.status).toBe(409);
    expect(again.body).toEqual({ message: 'Ujuzi already has a pending booking of this course for this event' });
    expect((await request(app()).get('/api/crew-trainings').set(me.auth)).body).toHaveLength(1);
  });

  it('answers 401 without a login', async () => {
    expect((await request(app()).get('/api/crew-trainings')).status).toBe(401);
    expect((await request(app()).get('/api/crew-trainings/trn_5001')).status).toBe(401);
  });

  it('answers 403 for someone else’s training and 404 for an unknown one', async () => {
    const me = await organiserWithEvent(app());
    const other = await organiserWithEvent(app());
    const mine = (await book(me)).body;
    const forbidden = await request(app()).get(`/api/crew-trainings/${mine.id}`).set(other.auth);
    expect(forbidden.status).toBe(403);
    expect(forbidden.body).toEqual({ message: 'You can only see your own crew trainings.' });
    const missing = await request(app()).get('/api/crew-trainings/trn_9999').set(me.auth);
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ message: 'Crew training trn_9999 not found' });
  });

  it('is read from our own database: it never calls Ujuzi', async () => {
    const me = await organiserWithEvent(app());
    const created = (await book(me)).body;
    const callsBefore = ujuzi().calls.length;
    await request(app()).get('/api/crew-trainings').set(me.auth);
    await request(app()).get(`/api/crew-trainings/${created.id}`).set(me.auth);
    expect(ujuzi().calls).toHaveLength(callsBefore);
  });
});

describe('PUT /api/crew-trainings/{id} (O4, S5)', () => {
  const put = (me: Me, id: string, body: unknown) =>
    request(app()).put(`/api/crew-trainings/${id}`).set(me.auth).set('Content-Type', 'application/json').send(JSON.stringify(body));

  it('replaces crew size and start at Ujuzi and here, and sending it twice gives the same result', async () => {
    const me = await organiserWithEvent(app());
    const created = (await book(me)).body;
    const change = { crewSize: 9, preferredStart: inDays(35) };
    const once = await put(me, created.id, change);
    const twice = await put(me, created.id, change);
    expect(once.status).toBe(200);
    expect(twice.status).toBe(200);
    expect(twice.body).toEqual(once.body);
    expect(keysOf(once.body)).toEqual(TRAINING_KEYS);
    expect(once.body).toMatchObject({ id: created.id, crewSize: 9, preferredStart: change.preferredStart, status: 'pending', createdAt: created.createdAt });
    expect([...ujuzi().bookings.values()][0]).toMatchObject({ crewSize: 9, preferredStart: change.preferredStart });
    expect((await request(app()).get(`/api/crew-trainings/${created.id}`).set(me.auth)).body).toEqual(once.body);
  });

  it.each([
    ['no crewSize', { preferredStart: 'FUTURE' }, 'crewSize is required'],
    ['no preferredStart', { crewSize: 5 }, 'preferredStart is required'],
    ['a crew of 0', { crewSize: 0, preferredStart: 'FUTURE' }, 'crewSize must be a whole number from 1 to 40'],
    ['a crew of 41', { crewSize: 41, preferredStart: 'FUTURE' }, 'crewSize must be a whole number'],
    ['a start in the past', { crewSize: 5, preferredStart: '2020-01-01T08:00:00Z' }, 'preferredStart must be in the future'],
    ['a start not before the event', { crewSize: 5, preferredStart: 'AFTER_EVENT' }, 'preferredStart must be before the event starts'],
    ['an extra field', { crewSize: 5, preferredStart: 'FUTURE', courseId: 'crs_502' }, 'Unknown field "courseId"'],
  ])('answers 400 { message } for %s, and changes nothing', async (_label, body, text) => {
    const me = await organiserWithEvent(app());
    const created = (await book(me)).body;
    const payload = JSON.parse(JSON.stringify(body).replace('FUTURE', inDays(35)).replace('AFTER_EVENT', inDays(61)));
    const callsBefore = ujuzi().calls.length;
    const res = await put(me, created.id, payload);
    expect(res.status).toBe(400);
    expect(res.body.message).toContain(text);
    expect(ujuzi().calls).toHaveLength(callsBefore);
    expect((await request(app()).get(`/api/crew-trainings/${created.id}`).set(me.auth)).body).toEqual(created);
  });

  it('answers 401, 403 and 404 in that order of importance', async () => {
    const me = await organiserWithEvent(app());
    const other = await organiserWithEvent(app());
    const created = (await book(me)).body;
    const change = { crewSize: 5, preferredStart: inDays(35) };
    expect((await request(app()).put(`/api/crew-trainings/${created.id}`).send(change)).status).toBe(401);
    const forbidden = await put(other, created.id, change);
    expect(forbidden.status).toBe(403);
    expect(forbidden.body).toEqual({ message: 'You can only change your own crew trainings.' });
    expect((await put(me, 'trn_9999', change)).status).toBe(404);
  });

  it('answers 409 when the training is no longer pending here', async () => {
    const me = await organiserWithEvent(app());
    const created = (await book(me)).body;
    const store = await getStore();
    await store.crewTrainings.update(created.id, { status: 'confirmed' });
    const res = await put(me, created.id, { crewSize: 5, preferredStart: inDays(35) });
    expect(res.status).toBe(409);
    expect(res.body.message).toBe(`Crew training ${created.id} is confirmed; only pending crew trainings can be changed`);
  });

  it('answers 409 when the centre decided at Ujuzi first, and brings our copy up to date', async () => {
    const me = await organiserWithEvent(app());
    const created = (await book(me)).body;
    ujuzi().decide([...ujuzi().bookings.keys()][0], 'confirmed'); // we have not polled yet
    const res = await put(me, created.id, { crewSize: 5, preferredStart: inDays(35) });
    expect(res.status).toBe(409);
    expect(res.body.message).toBe(`Crew training ${created.id} is now confirmed; only pending crew trainings can be changed`);
    expect((await request(app()).get(`/api/crew-trainings/${created.id}`).set(me.auth)).body.status).toBe('confirmed');
    expect([...ujuzi().bookings.values()][0].crewSize).toBe(6); // Ujuzi's booking is untouched
  });

  it('answers 409 when Ujuzi no longer has the booking', async () => {
    const me = await organiserWithEvent(app());
    const created = (await book(me)).body;
    ujuzi().bookings.clear();
    const res = await put(me, created.id, { crewSize: 5, preferredStart: inDays(35) });
    expect(res.status).toBe(409);
    expect(res.body.message).toContain('Ujuzi no longer has this booking');
  });

  it('answers our own 502 when Ujuzi is down, and changes nothing here', async () => {
    const me = await organiserWithEvent(app());
    const created = (await book(me)).body;
    ujuzi().mode = 'down';
    const res = await put(me, created.id, { crewSize: 5, preferredStart: inDays(35) });
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ message: 'Ujuzi is not responding right now. Try again in a minute.' });
    expect((await request(app()).get(`/api/crew-trainings/${created.id}`).set(me.auth)).body).toEqual(created);
  });
});

describe('DELETE /api/crew-trainings/{id} (O4, S5)', () => {
  const del = (me: Me, id: string) => request(app()).delete(`/api/crew-trainings/${id}`).set(me.auth);

  it('cancels at Ujuzi and here: 204, and it is gone from both', async () => {
    const me = await organiserWithEvent(app());
    const created = (await book(me)).body;
    const res = await del(me, created.id);
    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    expect(ujuzi().bookings.size).toBe(0);
    expect((await request(app()).get(`/api/crew-trainings/${created.id}`).set(me.auth)).status).toBe(404);
    expect((await request(app()).get('/api/crew-trainings').set(me.auth)).body).toEqual([]);
    expect((await del(me, created.id)).status).toBe(404);
  });

  it('still succeeds if Ujuzi had already forgotten the booking', async () => {
    const me = await organiserWithEvent(app());
    const created = (await book(me)).body;
    ujuzi().bookings.clear();
    expect((await del(me, created.id)).status).toBe(204);
    expect((await request(app()).get('/api/crew-trainings').set(me.auth)).body).toEqual([]);
  });

  it('answers 401, 403 and 404', async () => {
    const me = await organiserWithEvent(app());
    const other = await organiserWithEvent(app());
    const created = (await book(me)).body;
    expect((await request(app()).delete(`/api/crew-trainings/${created.id}`)).status).toBe(401);
    const forbidden = await del(other, created.id);
    expect(forbidden.status).toBe(403);
    expect(forbidden.body).toEqual({ message: 'You can only cancel your own crew trainings.' });
    expect(ujuzi().bookings.size).toBe(1);
    expect((await del(me, 'trn_9999')).status).toBe(404);
  });

  it('answers 409 when it is no longer pending, locally or at Ujuzi, and keeps it', async () => {
    const me = await organiserWithEvent(app());
    const a = (await book(me)).body;
    const store = await getStore();
    await store.crewTrainings.update(a.id, { status: 'declined' });
    const local = await del(me, a.id);
    expect(local.status).toBe(409);
    expect(local.body.message).toBe(`Crew training ${a.id} is declined; only pending crew trainings can be cancelled`);

    const b = (await book(me, { courseId: 'crs_502' })).body;
    ujuzi().decide([...ujuzi().bookings.keys()][1], 'confirmed');
    const remote = await del(me, b.id);
    expect(remote.status).toBe(409);
    expect(remote.body.message).toBe(`Crew training ${b.id} is now confirmed; only pending crew trainings can be cancelled`);
    expect((await request(app()).get(`/api/crew-trainings/${b.id}`).set(me.auth)).body.status).toBe('confirmed');
  });

  it('answers our own 502 when Ujuzi is down, and keeps the training', async () => {
    const me = await organiserWithEvent(app());
    const created = (await book(me)).body;
    ujuzi().mode = 'down';
    expect((await del(me, created.id)).status).toBe(502);
    ujuzi().mode = 'ok';
    expect((await request(app()).get(`/api/crew-trainings/${created.id}`).set(me.auth)).status).toBe(200);
    expect(ujuzi().bookings.size).toBe(1);
  });
});

describe('when Ujuzi is down, only the pages that need Ujuzi are affected (R7)', () => {
  it.each(['down', 'error500', 'slow', 'garbage', 'unauthorized', 'redirect', 'wrongShape', 'rateLimited'] as const)(
    'with Ujuzi %s: our own 502 for Ujuzi-backed calls, and everything else works',
    async (mode) => {
      const me = await organiserWithEvent(app());
      const created = (await book(me)).body; // booked while Ujuzi was well
      // a role of this organiser's own, so Kazi's offer below is not blocked by an earlier iteration's
      const role = (
        await request(app()).post(`/api/events/${me.eventId}/roles`).set(me.auth).send({
          title: 'Ushers', category: 'events', headcount: 3, shiftStart: inDays(60, 8), shiftEnd: inDays(60, 20), payPerShift: 1000,
        })
      ).body;
      ujuzi().mode = mode;
      ujuzi().slowMs = 5000;
      process.env.UJUZI_TIMEOUT_MS = '200';
      const log = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

      // Pages and endpoints that need Ujuzi answer our own 502 with our own words
      const needUjuzi = [
        request(app()).get('/api/training-options').set(me.auth),
        request(app()).post('/api/certificate-checks').set(me.auth).send({ certificateNo: 'UJZ-2026-00123' }),
        book(me),
        request(app()).put(`/api/crew-trainings/${created.id}`).set(me.auth).send({ crewSize: 5, preferredStart: inDays(35) }),
        request(app()).delete(`/api/crew-trainings/${created.id}`).set(me.auth),
      ];
      for (const res of await Promise.all(needUjuzi)) {
        expect(res.status).toBe(502);
        expect(res.body).toEqual({ message: 'Ujuzi is not responding right now. Try again in a minute.' });
      }

      // Everything else works as if nothing happened
      const fine = [
        request(app()).get('/'),
        request(app()).get('/api/events?status=upcoming'),
        request(app()).get(`/api/events/${me.eventId}`),
        request(app()).get(`/api/events/${me.eventId}/roles`),
        request(app()).get(`/api/events/${me.eventId}/offers`).set(me.auth),
        request(app()).get('/api/me').set(me.auth),
        request(app()).get('/api/crew-trainings').set(me.auth),
        request(app()).get(`/api/crew-trainings/${created.id}`).set(me.auth),
        request(app()).post('/api/offers').send({ roleId: role.id, workersOffered: 1 }),
      ];
      for (const res of await Promise.all(fine)) expect([200, 201]).toContain(res.status);

      // and nothing about Ujuzi's failure leaked into what we told our clients
      for (const res of await Promise.all(needUjuzi.slice(0, 2))) {
        expect(JSON.stringify(res.body)).not.toMatch(/ECONN|socket|redirect|<html|internal explosion|too many|127\.0\.0\.1/i);
      }
      log.mockRestore();
    },
  );

  it('recovers by itself when Ujuzi comes back', async () => {
    const me = await newOrganiser(app());
    ujuzi().mode = 'down';
    expect((await request(app()).get('/api/training-options').set(me.auth)).status).toBe(502);
    ujuzi().mode = 'ok';
    expect((await request(app()).get('/api/training-options').set(me.auth)).status).toBe(200);
  });

  it('answers 502 when Ujuzi is not configured at all', async () => {
    const me = await newOrganiser(app());
    process.env.UJUZI_API_URL = '';
    const log = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect((await request(app()).get('/api/training-options').set(me.auth)).status).toBe(502);
    log.mockRestore();
  });
});
