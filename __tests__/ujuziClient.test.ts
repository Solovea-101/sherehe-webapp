import {
  BACKGROUND_TIMEOUT_MS, CACHE_TTL_MS, PartnerRejectedError, PartnerUnavailableError, USER_TIMEOUT_MS, clearPartnerCache,
} from '@/lib/clients/fetcher';
import {
  cancelBooking, createBooking, getBooking, getCertificate, listCourses, updateBooking,
} from '@/lib/clients/ujuziClient';
import { startUjuziStub, type UjuziStub } from './helpers/ujuziStub';

let stub: UjuziStub;
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000);

beforeAll(async () => {
  stub = await startUjuziStub();
});
afterAll(async () => {
  await stub.close();
});
beforeEach(() => {
  stub.reset();
  clearPartnerCache();
  process.env.UJUZI_API_URL = stub.url;
  process.env.UJUZI_API_KEY = '';
  delete process.env.UJUZI_TIMEOUT_MS;
});
afterEach(() => jest.restoreAllMocks());

const unavailable = (pattern: RegExp) =>
  expect.objectContaining({ name: 'PartnerUnavailableError', partner: 'Ujuzi', message: expect.stringMatching(pattern) });

describe('configuration', () => {
  it.each([
    ['empty', '', 'UJUZI_API_URL is empty'],
    ['not a URL', 'ujuzi dot com', 'is not a URL'],
    ['not http', 'ftp://ujuzi.example.com', 'must be http or https'],
  ])('refuses to call Ujuzi when UJUZI_API_URL is %s', async (_label, value, why) => {
    process.env.UJUZI_API_URL = value;
    await expect(listCourses()).rejects.toThrow(PartnerUnavailableError);
    await expect(listCourses()).rejects.toThrow(why);
    expect(stub.calls).toHaveLength(0);
  });

  it('works with a trailing slash on the URL', async () => {
    process.env.UJUZI_API_URL = `${stub.url}/`;
    expect(await listCourses()).toHaveLength(4);
    expect(stub.calls[0].path).toBe('/api/courses');
  });

  it('sends our API key as X-API-Key when one is set, and none when it is not', async () => {
    await listCourses();
    expect(stub.calls[0].apiKey).toBeUndefined();
    process.env.UJUZI_API_KEY = 'secret-key-123';
    await getBooking('bkg_1');
    expect(stub.calls[1].apiKey).toBe('secret-key-123');
  });

  it('treats a refused key as an outage on our side of the fence, and never repeats the key', async () => {
    stub.requireKey = 'right-key';
    process.env.UJUZI_API_KEY = 'wrong-key';
    const error = await listCourses().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PartnerUnavailableError);
    expect((error as Error).message).toContain('refused our API key');
    expect((error as Error).message).not.toContain('wrong-key');
    process.env.UJUZI_API_KEY = 'right-key';
    expect(await listCourses()).toHaveLength(4);
  });
});

describe('S1: listCourses', () => {
  it('returns Ujuzi’s courses with every field of the contract', async () => {
    const courses = await listCourses();
    expect(courses.map((c) => c.id)).toEqual(['crs_501', 'crs_502', 'crs_503', 'crs_504']);
    expect(courses[0]).toEqual({
      id: 'crs_501', title: 'Food hygiene and event service', category: 'catering', centre: { id: 'cen_11', name: 'Westlands Skills Centre' },
      county: 'Nairobi', area: 'Westlands', durationWeeks: 2, feeKes: 3500, nextStart: '2026-11-23T07:00:00Z', certificateLevel: 'short-course',
    });
  });

  it('passes the category and county filters on', async () => {
    expect((await listCourses({ category: 'security' })).map((c) => c.id)).toEqual(['crs_502']);
    expect((await listCourses({ county: 'mombasa' })).map((c) => c.id)).toEqual(['crs_503']);
    expect(await listCourses({ category: 'plumbing' })).toEqual([]);
    expect(stub.calls.map((c) => c.path)).toEqual(['/api/courses?category=security', '/api/courses?county=mombasa', '/api/courses?category=plumbing']);
  });

  it('remembers an answer for 5 minutes, per filter, and asks again after that', async () => {
    const now = jest.spyOn(Date, 'now');
    const start = Date.now();
    now.mockReturnValue(start);
    await listCourses({ category: 'catering' });
    await listCourses({ category: 'catering' });
    expect(stub.calls).toHaveLength(1);
    await listCourses({ category: 'security' }); // a different question
    expect(stub.calls).toHaveLength(2);

    now.mockReturnValue(start + CACHE_TTL_MS - 1);
    await listCourses({ category: 'catering' });
    expect(stub.calls).toHaveLength(2);
    now.mockReturnValue(start + CACHE_TTL_MS + 1);
    await listCourses({ category: 'catering' });
    expect(stub.calls).toHaveLength(3);
  });

  it('hands out copies of remembered answers, so one caller cannot change another’s', async () => {
    const first = await listCourses();
    first[0].title = 'Tampered';
    first.pop();
    const second = await listCourses();
    expect(second).toHaveLength(4);
    expect(second[0].title).toBe('Food hygiene and event service');
  });

  it('does not remember a failure', async () => {
    stub.mode = 'error500';
    await expect(listCourses()).rejects.toThrow(PartnerUnavailableError);
    stub.mode = 'ok';
    expect(await listCourses()).toHaveLength(4);
  });
});

describe('S2: getCertificate', () => {
  it('returns a valid certificate and a revoked one', async () => {
    expect(await getCertificate('UJZ-2026-00123')).toEqual({
      certificateNo: 'UJZ-2026-00123', valid: true, courseTitle: 'Food hygiene and event service', level: 'short-course', issuedOn: '2026-08-14', holder: 'Achieng O.',
    });
    expect((await getCertificate('UJZ-2026-00124'))?.valid).toBe(false);
  });

  it('returns null for a number Ujuzi does not know', async () => {
    expect(await getCertificate('UJZ-2026-99999')).toBeNull();
  });

  it('is never remembered: a revocation shows at once', async () => {
    await getCertificate('UJZ-2026-00123');
    await getCertificate('UJZ-2026-00123');
    expect(stub.calls).toHaveLength(2);
  });
});

describe('S3, S4, S5: bookings', () => {
  const booking = () => ({ courseId: 'crs_501', crewSize: 6, preferredStart: inDays(30), eventName: 'Wanjiku and Otieno wedding' });

  it('createBooking sends exactly the four contract fields and returns the pending booking', async () => {
    const created = await createBooking(booking());
    expect(created).toMatchObject({ id: 'bkg_6001', courseId: 'crs_501', crewSize: 6, status: 'pending', eventName: 'Wanjiku and Otieno wedding' });
    const sent = stub.calls[0];
    expect([sent.method, sent.path]).toEqual(['POST', '/api/bookings']);
    expect(Object.keys(sent.body as object).sort()).toEqual(['courseId', 'crewSize', 'eventName', 'preferredStart']);
    expect((sent.body as { preferredStart: string }).preferredStart).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/); // no milliseconds
  });

  it.each([
    ['an unknown course', { courseId: 'crs_999' }, 404],
    ['a crew of 41', { crewSize: 41 }, 400],
    ['a start in the past', { preferredStart: inDays(-2) }, 400],
  ])('createBooking throws PartnerRejectedError for %s', async (_label, change, status) => {
    const error = await createBooking({ ...booking(), ...change }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PartnerRejectedError);
    expect((error as PartnerRejectedError).status).toBe(status);
    expect(stub.bookings.size).toBe(0);
  });

  it('getBooking returns the current state, including a decision made at Ujuzi, and is never remembered', async () => {
    const created = await createBooking(booking());
    expect((await getBooking(created.id))?.status).toBe('pending');
    stub.decide(created.id, 'confirmed');
    expect((await getBooking(created.id))?.status).toBe('confirmed');
    expect(stub.calls.filter((c) => c.method === 'GET')).toHaveLength(2);
  });

  it('getBooking returns null for an unknown booking, and encodes odd ids safely', async () => {
    expect(await getBooking('bkg_9999')).toBeNull();
    await getBooking('a/b?c=d');
    expect(stub.calls.at(-1)?.path).toBe('/api/bookings/a%2Fb%3Fc%3Dd');
  });

  it('updateBooking replaces crew size and start, and sending it twice gives the same result', async () => {
    const created = await createBooking(booking());
    const change = { crewSize: 8, preferredStart: inDays(40) };
    const once = await updateBooking(created.id, change);
    const twice = await updateBooking(created.id, change);
    expect(once).toEqual(twice);
    expect(once).toMatchObject({ crewSize: 8, status: 'pending' });
    expect(Object.keys(stub.calls.at(-1)!.body as object).sort()).toEqual(['crewSize', 'preferredStart']);
  });

  it('updateBooking: null if gone, PartnerRejectedError 409 once decided, 400 for bad values', async () => {
    expect(await updateBooking('bkg_9999', { crewSize: 2, preferredStart: inDays(5) })).toBeNull();
    const created = await createBooking(booking());
    await expect(updateBooking(created.id, { crewSize: 0, preferredStart: inDays(5) })).rejects.toMatchObject({ status: 400 });
    stub.decide(created.id, 'confirmed');
    await expect(updateBooking(created.id, { crewSize: 2, preferredStart: inDays(5) })).rejects.toMatchObject({ status: 409 });
  });

  it('cancelBooking: cancelled, then not_found, and PartnerRejectedError 409 once decided', async () => {
    const created = await createBooking(booking());
    expect(await cancelBooking(created.id)).toBe('cancelled');
    expect(await cancelBooking(created.id)).toBe('not_found');
    const decided = await createBooking(booking());
    stub.decide(decided.id, 'declined');
    await expect(cancelBooking(decided.id)).rejects.toBeInstanceOf(PartnerRejectedError);
    expect(stub.bookings.has(decided.id)).toBe(true);
  });
});

describe('when Ujuzi misbehaves, every call fails the same way: PartnerUnavailableError', () => {
  const calls: Array<[string, () => Promise<unknown>]> = [
    ['listCourses', () => listCourses()],
    ['getCertificate', () => getCertificate('UJZ-2026-00123')],
    ['getBooking', () => getBooking('bkg_6001')],
    ['createBooking', () => createBooking({ courseId: 'crs_501', crewSize: 2, preferredStart: inDays(9), eventName: 'E' })],
    ['updateBooking', () => updateBooking('bkg_6001', { crewSize: 2, preferredStart: inDays(9) })],
    ['cancelBooking', () => cancelBooking('bkg_6001')],
  ];

  it.each([
    ['is down', 'down', /could not be reached/],
    ['answers with a server error', 'error500', /failed with status 500/],
    ['refuses our key', 'unauthorized', /refused our API key/],
    ['answers with a page that is not JSON', 'garbage', /not JSON/],
    ['redirects somewhere else', 'redirect', /redirect/],
    ['limits us with a 429 (Ujuzi 0.3.0)', 'rateLimited', /unexpected status 429/],
  ] as const)('when Ujuzi %s', async (_label, mode, pattern) => {
    stub.mode = mode;
    for (const [name, run] of calls) {
      await expect(run()).rejects.toEqual(unavailable(pattern));
      expect(name).toBeTruthy();
    }
  });

  it('when Ujuzi is too slow, the call gives up at the timeout', async () => {
    process.env.UJUZI_TIMEOUT_MS = '150';
    stub.mode = 'slow';
    stub.slowMs = 1500;
    const started = Date.now();
    await expect(listCourses()).rejects.toEqual(unavailable(/did not answer in time/));
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('uses 10 seconds when a person is waiting and 60 in the background', async () => {
    expect(USER_TIMEOUT_MS).toBe(10_000);
    expect(BACKGROUND_TIMEOUT_MS).toBe(60_000);
    const timeout = jest.spyOn(AbortSignal, 'timeout');
    await listCourses();
    expect(timeout).toHaveBeenLastCalledWith(10_000);
    await getBooking('bkg_1', { background: true });
    expect(timeout).toHaveBeenLastCalledWith(60_000);
  });

  it('never follows a redirect, so our key cannot be sent to another host', async () => {
    process.env.UJUZI_API_KEY = 'secret-key-123';
    stub.mode = 'redirect';
    await expect(listCourses()).rejects.toThrow(PartnerUnavailableError);
    expect(stub.calls).toHaveLength(1); // the redirect target was never contacted (it does not even resolve)
  });

  it('refuses answers that do not match the contract, instead of passing on half-empty data', async () => {
    stub.mode = 'wrongShape';
    await expect(listCourses()).rejects.toEqual(unavailable(/course that does not match its contract/));
    await expect(getBooking('bkg_1')).rejects.toEqual(unavailable(/booking that does not match its contract/));
    await expect(getCertificate('UJZ-2026-00123')).rejects.toEqual(unavailable(/certificate that does not match its contract/));
  });

  it('refuses a status value or field type that Ujuzi’s contract does not allow', async () => {
    const created = await createBooking({ courseId: 'crs_501', crewSize: 2, preferredStart: inDays(9), eventName: 'E' });
    (stub.bookings.get(created.id) as { status: string }).status = 'cancelled'; // not in Ujuzi's enum
    await expect(getBooking(created.id)).rejects.toEqual(unavailable(/booking that does not match its contract/));
    (stub.bookings.get(created.id) as { status: string; crewSize: unknown }).status = 'pending';
    (stub.bookings.get(created.id) as { crewSize: unknown }).crewSize = '2';
    await expect(getBooking(created.id)).rejects.toEqual(unavailable(/booking that does not match its contract/));
  });

  it('recovers as soon as Ujuzi does', async () => {
    stub.mode = 'down';
    await expect(listCourses()).rejects.toThrow(PartnerUnavailableError);
    stub.mode = 'ok';
    expect(await listCourses()).toHaveLength(4);
  });
});
