import type { NextRequest } from 'next/server';
import { getStore } from '@/lib/db';
import { guard, json, notFound } from '@/lib/http';
import { toOffer, type ApiOffer } from '@/lib/mappers';

// K4: one offer and its status.
export async function GET(req: NextRequest, { params }: { params: Promise<{ offerId: string }> }) {
  return guard(async () => {
    const { offerId } = await params;
    const store = await getStore();
    const row = await store.offers.get(offerId);
    if (!row) return notFound('Offer', offerId);
    return json<ApiOffer>(200, toOffer(row));
  });
}
