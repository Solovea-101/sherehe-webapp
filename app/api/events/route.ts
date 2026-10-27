import type { NextRequest } from 'next/server';
import { requirePartner } from '@/lib/auth/partnerKey';
import { requireUser } from '@/lib/auth/session';
import { getStore } from '@/lib/db';
import { fail, guard, json, methodNotAllowed, readJson } from '@/lib/http';
import { toEvent, type ApiEvent } from '@/lib/mappers';
import { parseEventsQuery, parseNewEvent } from '@/lib/validation';

// K1: upcoming events, optionally in one county. Needs Kazi's partner key, or a logged-in organiser
// (the website cannot hold a partner key).
export async function GET(req: NextRequest) {
  return guard(async () => {
    const access = await requirePartner(req, { allowOrganiser: true });
    if (!access.ok) return access.response;
    const query = parseEventsQuery(req.nextUrl.searchParams);
    if (!query.ok) return fail(400, query.message);

    const store = await getStore();
    const rows = await store.events.list(query.value);
    return json<ApiEvent[]>(200, rows.map(toEvent));
  });
}

// O2: an organiser creates an event. It starts as upcoming and belongs to the logged-in organiser.
export async function POST(req: NextRequest) {
  return guard(async () => {
    const auth = await requireUser(req);
    if (!auth.ok) return auth.response;
    const body = await readJson(req);
    if (!body.ok) return body.response;
    const input = parseNewEvent(body.data);
    if (!input.ok) return fail(400, input.message);

    const store = await getStore();
    const row = await store.events.create({
      organiser_id: auth.user.id,
      name: input.value.name,
      type: input.value.type,
      county: input.value.county,
      area: input.value.area,
      venue: input.value.venue,
      starts_at: input.value.startsAt,
      ends_at: input.value.endsAt,
      expected_guests: input.value.expectedGuests,
      status: 'upcoming',
    });
    return json<ApiEvent>(201, toEvent(row), { Location: `/api/events/${row.id}` });
  });
}

// Any other method gets 405 with the methods this route does support.
export const PUT = methodNotAllowed(['GET', 'POST']);
export const PATCH = methodNotAllowed(['GET', 'POST']);
export const DELETE = methodNotAllowed(['GET', 'POST']);
