import { getStore } from '@/lib/db';
import { createBooking } from '@/lib/clients/ujuziClient';
import { clearPartnerCache } from '@/lib/clients/fetcher';
import { pollBookingsOnce, startBookingPoller } from '@/lib/jobs/bookingPoller';
import { inDays } from './helpers/dates';
import { startUjuziStub, type UjuziStub } from './helpers/ujuziStub';

let stub: UjuziStub;
beforeAll(async () => {
  stub = await startUjuziStub();
});
afterAll(async () => {
  await stub.close();
});
beforeEach(async () => {
  // rows left by earlier tests point at bookings the stub has since forgotten; start each test clean
  const store = await getStore();
  for (const leftover of await store.crewTrainings.listPending()) await store.crewTrainings.delete(leftover.id);
  stub.reset();
  clearPartnerCache();
  process.env.UJUZI_API_URL = stub.url;
  process.env.UJUZI_API_KEY = '';
  process.env.UJUZI_TIMEOUT_MS = '500';
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
  delete process.env.BOOKING_POLL_MS;
  process.env.UJUZI_API_URL = '';
});

/** A crew training that exists both at Ujuzi (pending) and in our store. */
async function trainingAtUjuzi(crewSize = 4) {
  const store = await getStore();
  const booking = await createBooking({ courseId: 'crs_501', crewSize, preferredStart: new Date(Date.now() + 30 * 86_400_000), eventName: 'Poller test' });
  const row = await store.crewTrainings.create({
    organiser_id: 'usr_1001', event_id: 'evt_2001', course_id: 'crs_501', ujuzi_booking_id: booking.id,
    crew_size: crewSize, preferred_start: new Date(booking.preferredStart), status: 'pending',
  });
  return { store, row, bookingId: booking.id };
}
const quiet = () => ({ warn: jest.spyOn(console, 'warn').mockImplementation(() => undefined), log: jest.spyOn(console, 'log').mockImplementation(() => undefined) });

describe('pollBookingsOnce', () => {
  it('records a decision made at Ujuzi: confirmed and declined', async () => {
    const a = await trainingAtUjuzi();
    const b = await trainingAtUjuzi();
    stub.decide(a.bookingId, 'confirmed');
    stub.decide(b.bookingId, 'declined');
    const summary = await pollBookingsOnce();
    expect(summary).toEqual({ checked: 2, updated: 2, failed: 0, missing: 0 });
    expect((await a.store.crewTrainings.get(a.row.id))?.status).toBe('confirmed');
    expect((await a.store.crewTrainings.get(b.row.id))?.status).toBe('declined');
  });

  it('leaves a training that is still pending at Ujuzi alone', async () => {
    const a = await trainingAtUjuzi();
    const before = await a.store.crewTrainings.get(a.row.id);
    const summary = await pollBookingsOnce();
    expect(summary.updated).toBe(0);
    expect(await a.store.crewTrainings.get(a.row.id)).toEqual(before);
  });

  it('does not ask about trainings that are already decided', async () => {
    const a = await trainingAtUjuzi();
    await a.store.crewTrainings.update(a.row.id, { status: 'confirmed' });
    const callsBefore = stub.calls.length;
    await pollBookingsOnce();
    expect(stub.calls.slice(callsBefore).filter((c) => c.path.includes(a.bookingId))).toHaveLength(0);
  });

  it('counts a booking Ujuzi no longer has, and leaves our record as it is', async () => {
    const { warn } = quiet();
    const a = await trainingAtUjuzi();
    stub.bookings.delete(a.bookingId);
    const summary = await pollBookingsOnce();
    expect(summary).toMatchObject({ checked: 1, missing: 1, updated: 0 });
    expect((await a.store.crewTrainings.get(a.row.id))?.status).toBe('pending');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(a.bookingId));
  });

  it('stops the round at the first sign Ujuzi is down, instead of waiting out every timeout', async () => {
    const { warn } = quiet();
    const a = await trainingAtUjuzi();
    await trainingAtUjuzi();
    await trainingAtUjuzi();
    expect(await a.store.crewTrainings.listPending()).toHaveLength(3);
    const callsBefore = stub.calls.length;
    stub.mode = 'down';
    const summary = await pollBookingsOnce();
    expect(summary).toMatchObject({ skipped: 'Ujuzi unavailable', failed: 1 });
    expect(stub.calls.length - callsBefore).toBe(1); // one attempt, not one per training
    expect(warn).toHaveBeenCalled();
    stub.mode = 'ok';
    stub.decide(a.bookingId, 'confirmed');
    expect((await pollBookingsOnce()).updated).toBe(1); // and picks up where it left off
  });

  it('never throws, even when the store fails', async () => {
    const { store } = await trainingAtUjuzi();
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(store.crewTrainings, 'listPending').mockRejectedValueOnce(new Error('db gone'));
    await expect(pollBookingsOnce()).resolves.toMatchObject({ failed: 1 });
    expect(error).toHaveBeenCalled();
  });

  it('does not run two rounds at once', async () => {
    quiet();
    await trainingAtUjuzi();
    stub.mode = 'slow';
    stub.slowMs = 200;
    const first = pollBookingsOnce();
    const second = await pollBookingsOnce();
    expect(second.skipped).toBe('already running');
    await first;
    expect((await pollBookingsOnce()).skipped).not.toBe('already running');
  });

  it('gives Ujuzi the long background timeout, not the short one a waiting person gets', async () => {
    quiet();
    delete process.env.UJUZI_TIMEOUT_MS;
    const timeout = jest.spyOn(AbortSignal, 'timeout');
    await trainingAtUjuzi();
    timeout.mockClear();
    await pollBookingsOnce();
    expect(timeout).toHaveBeenCalledWith(60_000);
  });
});

describe('startBookingPoller', () => {
  it('stays quiet and does nothing when Ujuzi is not configured', () => {
    const { log } = quiet();
    process.env.UJUZI_API_URL = '';
    const stop = startBookingPoller();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('not started'));
    expect(() => stop()).not.toThrow();
  });

  it('polls on its interval, picks up a decision made at Ujuzi, and stops when told to', async () => {
    quiet();
    const a = await trainingAtUjuzi();
    const stop = startBookingPoller({ intervalMs: 40 }); // a real, short interval: no faked timers around real I/O

    const waitFor = async (done: () => Promise<boolean>) => {
      for (let i = 0; i < 100; i += 1) {
        if (await done()) return true;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return false;
    };
    const status = async () => (await a.store.crewTrainings.get(a.row.id))?.status;

    // while Ujuzi has not decided, rounds run but change nothing
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(await status()).toBe('pending');
    expect(stub.calls.filter((c) => c.path.endsWith(a.bookingId)).length).toBeGreaterThanOrEqual(2); // it keeps asking

    stub.decide(a.bookingId, 'confirmed');
    expect(await waitFor(async () => (await status()) === 'confirmed')).toBe(true);

    stop();
    await new Promise((resolve) => setTimeout(resolve, 100)); // let a round in flight finish
    const asked = stub.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(stub.calls.length).toBe(asked); // nothing more after stop()
  });

  it('reads its interval from BOOKING_POLL_MS and does not hold the process open', () => {
    const { log } = quiet();
    process.env.BOOKING_POLL_MS = '90000';
    const stop = startBookingPoller();
    expect(log).toHaveBeenCalledWith('Booking poller started: every 90 s');
    stop();
  });
});
