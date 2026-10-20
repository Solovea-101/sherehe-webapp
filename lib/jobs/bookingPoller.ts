/**
 * Keeps our crew trainings in step with Ujuzi. A booking starts pending and is decided by the
 * training centre on Ujuzi's side, so every few minutes this asks Ujuzi about each pending one and
 * records the answer. Pages then read our own database and keep working while Ujuzi is down.
 */
import { PartnerUnavailableError } from '@/lib/clients/fetcher';
import { getBooking } from '@/lib/clients/ujuziClient';
import { getStore } from '@/lib/db';
import { toCrewTrainingStatus } from '@/lib/mappers';

export const DEFAULT_POLL_INTERVAL_MS = 5 * 60 * 1000;

export interface PollSummary {
  checked: number; // pending trainings asked about
  updated: number; // whose status had changed
  missing: number; // Ujuzi no longer has the booking (left as they are)
  failed: number;
  /** Why the round ended early or did not run, if it did. */
  skipped?: 'Ujuzi unavailable' | 'already running';
}

let running = false;

/** One round: ask Ujuzi about every pending crew training. Never throws. */
export async function pollBookingsOnce(): Promise<PollSummary> {
  const summary: PollSummary = { checked: 0, updated: 0, missing: 0, failed: 0 };
  if (running) return { ...summary, skipped: 'already running' };
  running = true;
  try {
    const store = await getStore();
    for (const training of await store.crewTrainings.listPending()) {
      summary.checked += 1;
      try {
        const booking = await getBooking(training.ujuzi_booking_id, { background: true });
        if (!booking) {
          summary.missing += 1;
          console.warn(`Booking poller: Ujuzi no longer has booking ${training.ujuzi_booking_id} (crew training ${training.id})`);
          continue;
        }
        const status = toCrewTrainingStatus(booking.status);
        if (status !== training.status) {
          await store.crewTrainings.update(training.id, { status });
          summary.updated += 1;
        }
      } catch (err) {
        summary.failed += 1;
        if (err instanceof PartnerUnavailableError) {
          // Ujuzi is down or asleep: asking about every other booking would only wait out the same timeout.
          console.warn(`Booking poller: stopping this round: ${err.message}`);
          summary.skipped = 'Ujuzi unavailable';
          break;
        }
        console.error(`Booking poller: crew training ${training.id} failed`, err);
      }
    }
  } catch (err) {
    summary.failed += 1;
    console.error('Booking poller: round failed', err);
  } finally {
    running = false;
  }
  return summary;
}

/**
 * Starts polling every BOOKING_POLL_MS (default 5 minutes). Returns a function that stops it.
 * Does nothing when UJUZI_API_URL is not set, so a clean clone stays quiet.
 */
export function startBookingPoller(options: { intervalMs?: number } = {}): () => void {
  if (!process.env.UJUZI_API_URL?.trim()) {
    console.log('Booking poller not started: UJUZI_API_URL is not set');
    return () => undefined;
  }
  const fromEnv = Number(process.env.BOOKING_POLL_MS);
  const intervalMs = options.intervalMs ?? (Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_POLL_INTERVAL_MS);
  const timer = setInterval(() => {
    void pollBookingsOnce().then((s) => {
      if (s.updated > 0) console.log(`Booking poller: ${s.updated} of ${s.checked} crew training(s) changed status`);
    });
  }, intervalMs);
  timer.unref(); // never keep the process alive just for this
  console.log(`Booking poller started: every ${Math.round(intervalMs / 1000)} s`);
  return () => clearInterval(timer);
}
