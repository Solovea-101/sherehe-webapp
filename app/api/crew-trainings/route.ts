import type { NextRequest } from 'next/server';
import { ownedEvent } from '@/lib/auth/ownership';
import { requireUser } from '@/lib/auth/session';
import { PartnerRejectedError } from '@/lib/clients/fetcher';
import { cancelBooking, createBooking } from '@/lib/clients/ujuziClient';
import { getStore } from '@/lib/db';
import { fail, guard, json, methodNotAllowed, notFound, readJson } from '@/lib/http';
import { toCrewTraining, toCrewTrainingStatus, toIso, type ApiCrewTraining } from '@/lib/mappers';
import { parseNewCrewTraining } from '@/lib/validation';

// O4 / S4: the logged-in organiser's crew trainings, newest first. Read from our own database; the
// poller keeps their status in step with Ujuzi, so this works even while Ujuzi is down.
export async function GET(req: NextRequest) {
  return guard(async () => {
    const auth = await requireUser(req);
    if (!auth.ok) return auth.response;
    const store = await getStore();
    const rows = await store.crewTrainings.listByOrganiser(auth.user.id);
    return json<ApiCrewTraining[]>(200, rows.map(toCrewTraining), { 'Cache-Control': 'no-store' });
  });
}

// O4 / S3: book crew training at Ujuzi for one of the organiser's events.
// Order of checks: logged in (401), body valid (400), event exists (404), event is theirs (403),
// event still upcoming (409), training starts before the event (400), then Ujuzi (404/400/409/502).
export async function POST(req: NextRequest) {
  return guard(async () => {
    const auth = await requireUser(req);
    if (!auth.ok) return auth.response;
    const body = await readJson(req);
    if (!body.ok) return body.response;
    const input = parseNewCrewTraining(body.data);
    if (!input.ok) return fail(400, input.message);

    const owned = await ownedEvent(auth.user, input.value.eventId, 'You can only book training for events you created.');
    if (!owned.ok) return owned.response;
    const event = owned.event;
    if (event.status !== 'upcoming') {
      return fail(409, `Event ${event.id} is ${event.status}; training can only be booked for upcoming events`);
    }
    if (input.value.preferredStart.getTime() >= event.starts_at.getTime()) {
      return fail(400, `preferredStart must be before the event starts (${toIso(event.starts_at)})`);
    }

    let booking;
    try {
      booking = await createBooking({
        courseId: input.value.courseId,
        crewSize: input.value.crewSize,
        preferredStart: input.value.preferredStart,
        eventName: event.name,
      });
    } catch (err) {
      if (err instanceof PartnerRejectedError) {
        if (err.status === 404) return notFound('Course', input.value.courseId);
        if (err.status === 409) return fail(409, 'Ujuzi already has a pending booking of this course for this event');
        return fail(400, 'Ujuzi did not accept the booking; check courseId, crewSize and preferredStart');
      }
      throw err; // Ujuzi unavailable: guard() answers 502
    }

    const store = await getStore();
    try {
      const row = await store.crewTrainings.create({
        organiser_id: auth.user.id,
        event_id: event.id,
        course_id: booking.courseId,
        ujuzi_booking_id: booking.id,
        crew_size: booking.crewSize,
        preferred_start: new Date(booking.preferredStart),
        status: toCrewTrainingStatus(booking.status),
      });
      return json<ApiCrewTraining>(201, toCrewTraining(row), { Location: `/api/crew-trainings/${row.id}` });
    } catch (err) {
      // Ujuzi has the booking but we could not record it. Take it back so nobody is billed for a
      // booking nobody can see; if even that fails, the log says which booking is orphaned.
      await cancelBooking(booking.id).catch((cancelErr: unknown) => {
        console.error(`ORPHANED BOOKING: Ujuzi booking ${booking.id} exists but could not be recorded or cancelled`, cancelErr);
      });
      throw err;
    }
  });
}

// Any other method gets 405 with the methods this route does support.
export const PUT = methodNotAllowed(['GET', 'POST']);
export const PATCH = methodNotAllowed(['GET', 'POST']);
export const DELETE = methodNotAllowed(['GET', 'POST']);
