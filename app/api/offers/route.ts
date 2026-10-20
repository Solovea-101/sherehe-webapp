import type { NextRequest } from 'next/server';
import { getStore } from '@/lib/db';
import { StoreConflictError } from '@/lib/db/types';
import { fail, guard, json, notFound, readJson } from '@/lib/http';
import { toOffer, type ApiOffer } from '@/lib/mappers';
import { parseNewOffer } from '@/lib/validation';

// K3: Kazi Connect offers workers for a role. The offer starts as pending.
//
// Checks, in order: body valid (400), role exists (404), its event is still upcoming (409), the role
// has open places (409), the offer is not bigger than the open places (400), the role has no other
// pending offer (409).
// TODO Week 9: require the partner's X-API-Key here (the contract documents a 401).
export async function POST(req: NextRequest) {
  return guard(async () => {
    const body = await readJson(req);
    if (!body.ok) return body.response;
    const input = parseNewOffer(body.data);
    if (!input.ok) return fail(400, input.message);

    const store = await getStore();
    const role = await store.roles.get(input.value.roleId);
    if (!role) return notFound('Role', input.value.roleId);

    const event = await store.events.get(role.event_id);
    if (!event) return notFound('Event', role.event_id); // cannot happen while roles reference events
    if (event.status !== 'upcoming') {
      return fail(409, `Event ${event.id} is ${event.status}; only upcoming events accept offers`);
    }

    const openPlaces = role.headcount - role.filled;
    if (openPlaces <= 0) return fail(409, `Role ${role.id} is full`);
    if (input.value.workersOffered > openPlaces) {
      return fail(400, `workersOffered must be a whole number from 1 to the open slots (${openPlaces} open on ${role.id})`);
    }

    const alreadyPending = () => fail(409, `Role ${role.id} already has a pending offer; wait for the organiser to decide or withdraw it`);
    if (await store.offers.findPendingByRole(role.id)) return alreadyPending();

    try {
      const row = await store.offers.create({
        role_id: role.id,
        event_id: role.event_id,
        workers_offered: input.value.workersOffered,
        note: input.value.note,
      });
      return json<ApiOffer>(201, toOffer(row), { Location: `/api/offers/${row.id}` });
    } catch (err) {
      if (err instanceof StoreConflictError) return alreadyPending(); // another offer got in first
      throw err;
    }
  });
}
