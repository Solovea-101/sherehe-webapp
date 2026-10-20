import type { NextRequest } from 'next/server';
import { burnPasswordCheck, verifyPassword } from '@/lib/auth/passwords';
import { startSession } from '@/lib/auth/session';
import { getStore } from '@/lib/db';
import { fail, guard, json, methodNotAllowed, readJson } from '@/lib/http';
import { toAuthResult, type ApiAuthResult } from '@/lib/mappers';
import { parseCredentials } from '@/lib/validation';

// O1: log in. A wrong password and an unknown email give the same answer in the same time.
export async function POST(req: NextRequest) {
  return guard(async () => {
    const body = await readJson(req);
    if (!body.ok) return body.response;
    const input = parseCredentials(body.data);
    if (!input.ok) return fail(400, input.message);

    const store = await getStore();
    const user = await store.users.findByEmail(input.value.email);
    const passwordOk = user
      ? await verifyPassword(input.value.password, user.password_hash)
      : (await burnPasswordCheck(input.value.password), false);
    if (!user || !passwordOk) return fail(401, 'Email or password is incorrect');

    const { token, expiresAt } = await startSession(store, user.id);
    return json<ApiAuthResult>(200, toAuthResult(user, token, expiresAt), { 'Cache-Control': 'no-store' });
  });
}

// Any other method gets 405 with the methods this route does support.
export const GET = methodNotAllowed(['POST']);
export const PUT = methodNotAllowed(['POST']);
export const PATCH = methodNotAllowed(['POST']);
export const DELETE = methodNotAllowed(['POST']);
