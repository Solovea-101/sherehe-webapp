import type { NextRequest } from 'next/server';
import { ownedTraining } from '@/lib/auth/ownership';
import { requireUser } from '@/lib/auth/session';
import { PartnerRejectedError, PartnerUnavailableError } from '@/lib/clients/fetcher';
import { cancelBooking, getBooking, updateBooking } from '@/lib/clients/ujuziClient';
import { getStore } from '@/lib/db';
import type { CrewTrainingRow } from '@/lib/db/types';
import { fail, guard, json, methodNotAllowed, noContent, notFound, readJson } from '@/lib/http';
import { toCrewTraining, toCrewTrainingStatus, toIso, type ApiCrewTraining } from '@/lib/mappers';
import { parseCrewTrainingUpdate } from '@/lib/validation';

type Params = { params: Promise<{ trainingId: string }> };

/**
 * Ujuzi said "not pending" to a change or a cancel, so what we hold is out of date. Bring our copy
 * up to date if Ujuzi lets us, and say what the status is now.
 */
async function staleStatusConflict(row: CrewTrainingRow, verb: string) {
  let status = row.status;
  try {
    const latest = await getBooking(row.ujuzi_booking_id);
    if (latest) {
      status = toCrewTrainingStatus(latest.status);
      const store = await getStore();
      await store.crewTrainings.update(row.id, { status });
    }
  } catch (err) {
    if (!(err instanceof PartnerUnavailableError)) throw err; // best effort: say what we last knew
  }
  return fail(409, `Crew training ${row.id} is now ${status}; only pending crew trainings can be ${verb}`);
}

// O4 / S4: one crew training and its status, from our own database.
export async function GET(req: NextRequest, { params }: Params) {
  return guard(async () => {
    const { trainingId } = await params;
    const auth = await requireUser(req);
    if (!auth.ok) return auth.response;
    const owned = await ownedTraining(auth.user, trainingId, 'You can only see your own crew trainings.');
    if (!owned.ok) return owned.response;
    return json<ApiCrewTraining>(200, toCrewTraining(owned.training), { 'Cache-Control': 'no-store' });
  });
}

// O4 / S5: replace crew size and start date of a pending crew training. PUT sets an absolute state,
// so sending the same body twice gives the same result.
// Order of checks: logged in (401), exists (404), theirs (403), body valid (400), start before the
// event (400), still pending (409), then Ujuzi (400/409/502).
export async function PUT(req: NextRequest, { params }: Params) {
  return guard(async () => {
    const { trainingId } = await params;
    const auth = await requireUser(req);
    if (!auth.ok) return auth.response;
    const owned = await ownedTraining(auth.user, trainingId, 'You can only change your own crew trainings.');
    if (!owned.ok) return owned.response;
    const row = owned.training;

    const body = await readJson(req);
    if (!body.ok) return body.response;
    const input = parseCrewTrainingUpdate(body.data);
    if (!input.ok) return fail(400, input.message);

    const store = await getStore();
    const event = await store.events.get(row.event_id);
    if (event && input.value.preferredStart.getTime() >= event.starts_at.getTime()) {
      return fail(400, `preferredStart must be before the event starts (${toIso(event.starts_at)})`);
    }
    if (row.status !== 'pending') {
      return fail(409, `Crew training ${row.id} is ${row.status}; only pending crew trainings can be changed`);
    }

    let booking;
    try {
      booking = await updateBooking(row.ujuzi_booking_id, input.value);
    } catch (err) {
      if (err instanceof PartnerRejectedError) {
        if (err.status === 409) return staleStatusConflict(row, 'changed');
        return fail(400, 'Ujuzi did not accept those values; check crewSize and preferredStart');
      }
      throw err;
    }
    if (!booking) return fail(409, 'Ujuzi no longer has this booking. Cancel this crew training and book again.');

    const updated = await store.crewTrainings.update(row.id, {
      crew_size: booking.crewSize,
      preferred_start: new Date(booking.preferredStart),
      status: toCrewTrainingStatus(booking.status),
    });
    if (!updated) return notFound('Crew training', row.id); // cancelled a moment ago
    return json<ApiCrewTraining>(200, toCrewTraining(updated));
  });
}

// O4 / S5: cancel a pending crew training. It is cancelled at Ujuzi first, then forgotten here.
export async function DELETE(req: NextRequest, { params }: Params) {
  return guard(async () => {
    const { trainingId } = await params;
    const auth = await requireUser(req);
    if (!auth.ok) return auth.response;
    const owned = await ownedTraining(auth.user, trainingId, 'You can only cancel your own crew trainings.');
    if (!owned.ok) return owned.response;
    const row = owned.training;
    if (row.status !== 'pending') {
      return fail(409, `Crew training ${row.id} is ${row.status}; only pending crew trainings can be cancelled`);
    }

    try {
      await cancelBooking(row.ujuzi_booking_id); // 'not_found' means Ujuzi already forgot it: same end result
    } catch (err) {
      if (err instanceof PartnerRejectedError && err.status === 409) return staleStatusConflict(row, 'cancelled');
      throw err;
    }
    const store = await getStore();
    await store.crewTrainings.delete(row.id);
    return noContent();
  });
}

// Any other method gets 405 with the methods this route does support.
export const POST = methodNotAllowed(['GET', 'PUT', 'DELETE']);
export const PATCH = methodNotAllowed(['GET', 'PUT', 'DELETE']);
