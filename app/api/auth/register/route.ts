import type { NextRequest } from 'next/server';
import { hashPassword } from '@/lib/auth/passwords';
import { startSession } from '@/lib/auth/session';
import { getStore } from '@/lib/db';
import { StoreConflictError } from '@/lib/db/types';
import { fail, guard, json, methodNotAllowed, readJson } from '@/lib/http';
import { toAuthResult, type ApiAuthResult } from '@/lib/mappers';
import { parseNewAccount } from '@/lib/validation';

// O1: create an organiser account and log it in.
export async function POST(req: NextRequest) {
  return guard(async () => {
    const body = await readJson(req);
    if (!body.ok) return body.response;
    const input = parseNewAccount(body.data);
    if (!input.ok) return fail(400, input.message);

    const store = await getStore();
    const taken = () => fail(409, 'An account with that email already exists. Log in instead.');
    if (await store.users.findByEmail(input.value.email)) return taken();

    try {
      const user = await store.users.create({
        email: input.value.email,
        name: input.value.name,
        password_hash: await hashPassword(input.value.password),
      });
      const { token, expiresAt } = await startSession(store, user.id);
      return json<ApiAuthResult>(201, toAuthResult(user, token, expiresAt), { 'Cache-Control': 'no-store' });
    } catch (err) {
      if (err instanceof StoreConflictError) return taken(); // someone registered it a moment ago
      throw err;
    }
  });
}

// Any other method gets 405 with the methods this route does support.
export const GET = methodNotAllowed(['POST']);
export const PUT = methodNotAllowed(['POST']);
export const PATCH = methodNotAllowed(['POST']);
export const DELETE = methodNotAllowed(['POST']);
