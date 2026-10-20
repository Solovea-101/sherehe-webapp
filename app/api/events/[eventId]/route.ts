import type { NextRequest } from 'next/server';
import { getStore } from '@/lib/db';
import { guard, json, notFound } from '@/lib/http';
import { toEvent, type ApiEvent } from '@/lib/mappers';

// K1: one event.
export async function GET(req: NextRequest, { params }: { params: Promise<{ eventId: string }> }) {
  return guard(async () => {
    const { eventId } = await params;
    const store = await getStore();
    const row = await store.events.get(eventId);
    if (!row) return notFound('Event', eventId);
    return json<ApiEvent>(200, toEvent(row));
  });
}
