import type { NextRequest } from 'next/server';
import { getStore } from '@/lib/db';
import { guard, json, notFound } from '@/lib/http';
import { toRole, type ApiRole } from '@/lib/mappers';

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
