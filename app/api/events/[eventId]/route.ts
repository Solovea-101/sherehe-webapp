import type { NextRequest } from 'next/server';
import { requirePartner } from '@/lib/auth/partnerKey';
import { getStore } from '@/lib/db';
import { guard, json, methodNotAllowed, notFound } from '@/lib/http';
import { toEvent, type ApiEvent } from '@/lib/mappers';

// K1: one event. Partner key, or a logged-in organiser.
export async function GET(req: NextRequest, { params }: { params: Promise<{ eventId: string }> }) {
  return guard(async () => {
    const { eventId } = await params;
    const access = await requirePartner(req, { allowOrganiser: true });
    if (!access.ok) return access.response;
    const store = await getStore();
    const row = await store.events.get(eventId);
    if (!row) return notFound('Event', eventId);
    return json<ApiEvent>(200, toEvent(row));
  });
}

// Any other method gets 405 with the methods this route does support.
export const POST = methodNotAllowed(['GET']);
export const PUT = methodNotAllowed(['GET']);
export const PATCH = methodNotAllowed(['GET']);
export const DELETE = methodNotAllowed(['GET']);
