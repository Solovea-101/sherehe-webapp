import type { NextResponse } from 'next/server';
import { getStore } from '@/lib/db';
import type { CrewTrainingRow, EventRow, UserRow } from '@/lib/db/types';
import { fail, notFound, type ErrorBody } from '@/lib/http';

export type OwnedEvent = { ok: true; event: EventRow } | { ok: false; response: NextResponse<ErrorBody> };

/**
 * Finds an event and checks that this organiser created it: 404 if there is no such event, 403 if
 * it belongs to someone else. `forbiddenMessage` says what they may not do, for example
 * "You can only add roles to events you created."
 */
export async function ownedEvent(user: UserRow, eventId: string, forbiddenMessage: string): Promise<OwnedEvent> {
  const store = await getStore();
  const event = await store.events.get(eventId);
  if (!event) return { ok: false, response: notFound('Event', eventId) };
  if (event.organiser_id !== user.id) return { ok: false, response: fail(403, forbiddenMessage) };
  return { ok: true, event };
}

export type OwnedTraining = { ok: true; training: CrewTrainingRow } | { ok: false; response: NextResponse<ErrorBody> };

/** Finds a crew training and checks that this organiser booked it: 404 if unknown, 403 if someone else's. */
export async function ownedTraining(user: UserRow, trainingId: string, forbiddenMessage: string): Promise<OwnedTraining> {
  const store = await getStore();
  const training = await store.crewTrainings.get(trainingId);
  if (!training) return { ok: false, response: notFound('Crew training', trainingId) };
  if (training.organiser_id !== user.id) return { ok: false, response: fail(403, forbiddenMessage) };
  return { ok: true, training };
}
