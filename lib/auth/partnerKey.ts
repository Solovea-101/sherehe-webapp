import type { NextResponse } from 'next/server';
import { bearerToken, requireUser } from '@/lib/auth/session';
import { describePartnerKeys, findIssuedKey, OPEN_PARTNER, readPartnerKeyConfig } from '@/lib/auth/partnerKeyConfig';
import { fail, type ErrorBody } from '@/lib/http';

// The settings code (PARTNER_KEYS, fail-closed, the log line) is in partnerKeyConfig.ts. It is
// re-exported here so callers can keep importing from one place.
export { describePartnerKeys, findIssuedKey, OPEN_PARTNER, readPartnerKeyConfig } from '@/lib/auth/partnerKeyConfig';
export type { PartnerKey, PartnerKeyConfig } from '@/lib/auth/partnerKeyConfig';

const WARNED = Symbol.for('sherehe.partnerKeyWarned');

export type PartnerAccess =
  | { ok: true; via: 'organiser' }
  | { ok: true; via: 'open' | 'partner-key'; partner: string }
  | { ok: false; response: NextResponse<ErrorBody> };

const unauthorized = (): { ok: false; response: NextResponse<ErrorBody> } => ({
  ok: false,
  response: fail(401, 'Send your partner key as X-API-Key', { 'WWW-Authenticate': 'ApiKey' }),
});

/**
 * Guards a partner endpoint. Use at the top of the handler:
 *
 *   const access = await requirePartner(req);
 *   if (!access.ok) return access.response;
 *
 * With `allowOrganiser`, a logged-in organiser's Bearer token is accepted instead of a key. The
 * website needs that for the three read endpoints, because a partner key must never reach a browser.
 */
export async function requirePartner(req: Request, opts: { allowOrganiser?: boolean } = {}): Promise<PartnerAccess> {
  const config = readPartnerKeyConfig();
  const g = globalThis as typeof globalThis & { [WARNED]?: boolean };
  if (!g[WARNED]) {
    g[WARNED] = true;
    const { level, text } = describePartnerKeys(config);
    console[level](text);
  }

  // Open only when asked for (never in production) and only while no key at all has been set up.
  if (config.open && config.keys.length === 0 && config.ignored === 0) return { ok: true, via: 'open', partner: OPEN_PARTNER };

  const key = req.headers.get('x-api-key')?.trim();
  const partner = key && key.length <= 200 ? findIssuedKey(key, config.keys) : null;
  if (partner) return { ok: true, via: 'partner-key', partner };

  if (opts.allowOrganiser && bearerToken(req)) {
    const organiser = await requireUser(req);
    if (organiser.ok) return { ok: true, via: 'organiser' };
  }
  return unauthorized();
}

/** For the endpoints only a partner may call (offers): the consumer's name, or the 401 to send. */
export async function requirePartnerKey(req: Request): Promise<{ ok: true; partner: string } | { ok: false; response: NextResponse<ErrorBody> }> {
  const access = await requirePartner(req);
  if (!access.ok) return access;
  return access.via === 'organiser' ? unauthorized() : { ok: true, partner: access.partner };
}
