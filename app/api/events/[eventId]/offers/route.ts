import type { NextRequest } from 'next/server';
import { ownedEvent } from '@/lib/auth/ownership';
import { requireUser } from '@/lib/auth/session';
import { getStore } from '@/lib/db';
import { guard, json, methodNotAllowed } from '@/lib/http';
import { toOffer, type ApiOffer } from '@/lib/mappers';

// O3: the offers on an event, for the organiser who created it. Oldest first; [] when there are none.
export async function GET(req: NextRequest, { params }: { params: Promise<{ eventId: string }> }) {
  return guard(async () => {
    const { eventId } = await params;
    const auth = await requireUser(req);
    if (!auth.ok) return auth.response;
    const owned = await ownedEvent(auth.user, eventId, 'You can only see the offers on events you created.');
    if (!owned.ok) return owned.response;

    const store = await getStore();
    const rows = await store.offers.listByEvent(eventId);
    return json<ApiOffer[]>(200, rows.map(toOffer), { 'Cache-Control': 'no-store' });
  });
}

// Any other method gets 405 with the methods this route does support.
export const POST = methodNotAllowed(['GET']);
export const PUT = methodNotAllowed(['GET']);
export const PATCH = methodNotAllowed(['GET']);
export const DELETE = methodNotAllowed(['GET']);
