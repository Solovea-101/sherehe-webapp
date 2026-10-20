import type { NextResponse } from 'next/server';
import { getStore } from '@/lib/db';
import type { EventRow, UserRow } from '@/lib/db/types';
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
