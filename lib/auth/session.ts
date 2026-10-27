import { randomBytes } from 'node:crypto';
import type { NextResponse } from 'next/server';
import { getStore } from '@/lib/db';
import type { Store, UserRow } from '@/lib/db/types';
import { fail, type ErrorBody } from '@/lib/http';
import { sha256Hex } from './hash';

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // a login lasts a week
const MAX_TOKEN_LENGTH = 200; // ours are 43 characters; refuse to hash anything much longer

export { sha256Hex };

/** Starts a login. Only the token's SHA-256 is stored, so a database leak does not leak logins. */
export async function startSession(store: Store, userId: string, now: Date = new Date()) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await store.sessions.create({ token_hash: sha256Hex(token), user_id: userId, expires_at: expiresAt });
  return { token, expiresAt };
}

/** The token from "Authorization: Bearer TOKEN", or undefined if the header is missing or odd. */
export function bearerToken(req: Request): string | undefined {
  const match = /^Bearer ([^\s]+)$/i.exec(req.headers.get('authorization')?.trim() ?? '');
  const token = match?.[1];
  return token && token.length <= MAX_TOKEN_LENGTH ? token : undefined;
}

const WWW_AUTHENTICATE = { 'WWW-Authenticate': 'Bearer' };

export type Authenticated =
  | { ok: true; user: UserRow; tokenHash: string }
  | { ok: false; response: NextResponse<ErrorBody> };

/**
 * Who is calling? Use at the top of every organiser endpoint:
 *
 *   const auth = await requireUser(req);
 *   if (!auth.ok) return auth.response;
 */
export async function requireUser(req: Request, now: Date = new Date()): Promise<Authenticated> {
  const token = bearerToken(req);
  if (!token) {
    return {
      ok: false,
      response: fail(401, 'Log in, then send your token as Authorization: Bearer YOUR_TOKEN', WWW_AUTHENTICATE),
    };
  }

  const store = await getStore();
  const tokenHash = sha256Hex(token);
  const session = await store.sessions.findByTokenHash(tokenHash);
  const invalid = () => ({
    ok: false as const,
    response: fail(401, 'Your login is not valid or has expired. Log in again.', WWW_AUTHENTICATE),
  });
  if (!session) return invalid();
  if (session.expires_at.getTime() <= now.getTime()) {
    await store.sessions.delete(tokenHash); // tidy up as we notice
    return invalid();
  }
  const user = await store.users.findById(session.user_id);
  if (!user) return invalid();
  return { ok: true, user, tokenHash };
}
