import type { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { getStore } from '@/lib/db';
import { fail, guard, json, noContent, notFound, readJson } from '@/lib/http';
import { toOffer, type ApiOffer } from '@/lib/mappers';
import { parseOfferDecision } from '@/lib/validation';

type Params = { params: Promise<{ offerId: string }> };

// K4: one offer and its status.
export async function GET(req: NextRequest, { params }: Params) {
  return guard(async () => {
    const { offerId } = await params;
    const store = await getStore();
    const row = await store.offers.get(offerId);
    if (!row) return notFound('Offer', offerId);
    return json<ApiOffer>(200, toOffer(row));
  });
}

// K5: Kazi Connect withdraws an offer. Only a pending one can be withdrawn; afterwards it is gone.
// TODO Week 9: require the partner's X-API-Key here (the contract documents a 401).
export async function DELETE(req: NextRequest, { params }: Params) {
  return guard(async () => {
    const { offerId } = await params;
    const store = await getStore();
    const result = await store.offers.withdraw(offerId);
    if (result.kind === 'not_found') return notFound('Offer', offerId);
    if (result.kind === 'not_pending') {
      return fail(409, `Offer ${offerId} is ${result.offer.status}; only pending offers can be withdrawn`);
    }
    return noContent();
  });
}

// O3: the organiser accepts or declines an offer on their own event. Accepting fills places on the
// role. Order of checks: logged in (401), offer exists (404), event is theirs (403), body valid
// (400), event still upcoming (409), offer still pending and the role has room (409).
export async function PATCH(req: NextRequest, { params }: Params) {
  return guard(async () => {
    const { offerId } = await params;
    const auth = await requireUser(req);
    if (!auth.ok) return auth.response;

    const store = await getStore();
    const offer = await store.offers.get(offerId);
    if (!offer) return notFound('Offer', offerId);
    const event = await store.events.get(offer.event_id);
    if (!event) return notFound('Event', offer.event_id); // cannot happen while offers reference events
    if (event.organiser_id !== auth.user.id) {
      return fail(403, 'You can only decide offers on events you created.');
    }

    const body = await readJson(req);
    if (!body.ok) return body.response;
    const input = parseOfferDecision(body.data);
    if (!input.ok) return fail(400, input.message);
    if (event.status !== 'upcoming') {
      return fail(409, `Event ${event.id} is ${event.status}; its offers can no longer be decided`);
    }

    const result = await store.offers.decide(offerId, input.value.status);
    switch (result.kind) {
      case 'ok':
        return json<ApiOffer>(200, toOffer(result.offer));
      case 'not_found':
        return notFound('Offer', offerId); // withdrawn a moment ago
      case 'not_pending':
        return fail(409, `Offer ${offerId} is already ${result.offer.status}; accepted and declined are final`);
      case 'no_room':
        return fail(
          409,
          `Role ${offer.role_id} has ${result.openPlaces} open place${result.openPlaces === 1 ? '' : 's'}, fewer than the ${offer.workers_offered} offered`,
        );
    }
  });
}
