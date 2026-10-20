import type { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { guard, json, methodNotAllowed } from '@/lib/http';
import { toUser, type ApiUser } from '@/lib/mappers';

// O1: the logged-in organiser.
export async function GET(req: NextRequest) {
  return guard(async () => {
    const auth = await requireUser(req);
    if (!auth.ok) return auth.response;
    return json<ApiUser>(200, toUser(auth.user), { 'Cache-Control': 'no-store' });
  });
}

// Any other method gets 405 with the methods this route does support.
export const POST = methodNotAllowed(['GET']);
export const PUT = methodNotAllowed(['GET']);
export const PATCH = methodNotAllowed(['GET']);
export const DELETE = methodNotAllowed(['GET']);
