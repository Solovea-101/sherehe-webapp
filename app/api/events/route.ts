import type { NextRequest } from 'next/server';
import { getStore } from '@/lib/db';
import { fail, guard, json } from '@/lib/http';
import { toEvent, type ApiEvent } from '@/lib/mappers';
import { parseEventsQuery } from '@/lib/validation';

// K1: upcoming events, optionally in one county.
export async function GET(req: NextRequest) {
  return guard(async () => {
    const query = parseEventsQuery(req.nextUrl.searchParams);
    if (!query.ok) return fail(400, query.message);

    const store = await getStore();
    const rows = await store.events.list(query.value);
    return json<ApiEvent[]>(200, rows.map(toEvent));
  });
}
