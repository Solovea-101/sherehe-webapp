import type { NextRequest } from 'next/server';
import { requirePartner } from '@/lib/auth/partnerKey';
import { json, methodNotAllowed } from '@/lib/http';
import { statsReport, type StatsReport } from '@/lib/monitoring';

// Week 12: the running totals, so the API can be seen without watching the log. An operations endpoint, not one of
// the ring's partner endpoints: it is documented in the README and deliberately not in openapi.yaml, because it
// serves no partner need and would otherwise be a contract change to announce to Kazi Connect (R8). It needs a
// partner key like every other partner endpoint. The request that asks is not yet counted in its own answer, but
// it is in the next one.
export async function GET(req: NextRequest) {
  const access = await requirePartner(req);
  if (!access.ok) return access.response;
  return json<StatsReport>(200, statsReport());
}

export const POST = methodNotAllowed(['GET']);
export const PUT = methodNotAllowed(['GET']);
export const PATCH = methodNotAllowed(['GET']);
export const DELETE = methodNotAllowed(['GET']);
