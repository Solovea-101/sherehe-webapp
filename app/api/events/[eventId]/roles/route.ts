import type { NextRequest } from 'next/server';
import { ownedEvent } from '@/lib/auth/ownership';
import { requireUser } from '@/lib/auth/session';
import { getStore } from '@/lib/db';
import { fail, guard, json, methodNotAllowed, notFound, readJson } from '@/lib/http';
import { toRole, type ApiRole } from '@/lib/mappers';
import { parseNewRole } from '@/lib/validation';

// K2: the staffing roles of one event. An event with no roles answers [], an unknown event 404.
export async function GET(req: NextRequest, { params }: { params: Promise<{ eventId: string }> }) {
  return guard(async () => {
    const { eventId } = await params;
    const store = await getStore();
    if (!(await store.events.get(eventId))) return notFound('Event', eventId);

    const rows = await store.roles.listByEvent(eventId);
    return json<ApiRole[]>(200, rows.map(toRole));
  });
}

// O2: an organiser adds a staffing role to their own upcoming event.
// Order of checks: logged in (401), event exists (404), event is theirs (403), body valid (400),
// event still upcoming (409).
export async function POST(req: NextRequest, { params }: { params: Promise<{ eventId: string }> }) {
  return guard(async () => {
    const { eventId } = await params;
    const auth = await requireUser(req);
    if (!auth.ok) return auth.response;
    const owned = await ownedEvent(auth.user, eventId, 'You can only add roles to events you created.');
    if (!owned.ok) return owned.response;

    const body = await readJson(req);
    if (!body.ok) return body.response;
    const input = parseNewRole(body.data);
    if (!input.ok) return fail(400, input.message);
    if (owned.event.status !== 'upcoming') {
      return fail(409, `Event ${owned.event.id} is ${owned.event.status}; roles can only be added to upcoming events`);
    }

    const store = await getStore();
    const row = await store.roles.create({
      event_id: eventId,
      title: input.value.title,
      category: input.value.category,
      headcount: input.value.headcount,
      filled: 0,
      shift_start: input.value.shiftStart,
      shift_end: input.value.shiftEnd,
      pay_per_shift: input.value.payPerShift,
    });
    return json<ApiRole>(201, toRole(row));
  });
}

// Any other method gets 405 with the methods this route does support.
export const PUT = methodNotAllowed(['GET', 'POST']);
export const PATCH = methodNotAllowed(['GET', 'POST']);
export const DELETE = methodNotAllowed(['GET', 'POST']);
