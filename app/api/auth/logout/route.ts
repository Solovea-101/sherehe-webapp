import type { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { getStore } from '@/lib/db';
import { guard, methodNotAllowed, noContent } from '@/lib/http';

// O1: log out. The token stops working at once; other logins of the same organiser are untouched.
export async function POST(req: NextRequest) {
  return guard(async () => {
    const auth = await requireUser(req);
    if (!auth.ok) return auth.response;
    const store = await getStore();
    await store.sessions.delete(auth.tokenHash);
    return noContent();
  });
}

// Any other method gets 405 with the methods this route does support.
export const GET = methodNotAllowed(['POST']);
export const PUT = methodNotAllowed(['POST']);
export const PATCH = methodNotAllowed(['POST']);
export const DELETE = methodNotAllowed(['POST']);
