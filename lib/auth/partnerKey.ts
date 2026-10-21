import { timingSafeEqual } from 'node:crypto';
import type { NextResponse } from 'next/server';
import { sha256Hex } from '@/lib/auth/hash';
import { bearerToken, requireUser } from '@/lib/auth/session';
import { fail, type ErrorBody } from '@/lib/http';

/**
 * Partner keys (R4). Kazi Connect proves who it is with an X-API-Key header. Sherehe keeps only the
 * SHA-256 of each key it has issued, in PARTNER_KEYS (comma-separated), never the key itself, so a
 * leaked environment or database cannot be used to call us. Keys are made with `npm run partner:key`.
 *
 * When PARTNER_KEYS is empty the partner endpoints stay open, so a clean clone works and the
 * Week 5-8 behaviour is unchanged; a warning says so once. Set REQUIRE_PARTNER_KEY=true to refuse
 * every partner call until a key is configured instead (what a deployment should do). If
 * PARTNER_KEYS holds entries that are not valid hashes, everything is refused rather than opened.
 */
const HEX_SHA256 = /^[0-9a-f]{64}$/;
const WARNED = Symbol.for('sherehe.partnerKeyWarned');

export interface PartnerKeyConfig {
  hashes: Buffer[];
  /** PARTNER_KEYS entries that are not 64 hex characters, so they can never match. */
  ignored: number;
  required: boolean;
}

/** Reads PARTNER_KEYS and REQUIRE_PARTNER_KEY now; the settings are looked at on every request. */
export function readPartnerKeyConfig(env: { [name: string]: string | undefined } = process.env): PartnerKeyConfig {
  const entries = (env.PARTNER_KEYS ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  const valid = entries.filter((e) => HEX_SHA256.test(e));
  return {
    hashes: valid.map((h) => Buffer.from(h, 'hex')),
    ignored: entries.length - valid.length,
    required: env.REQUIRE_PARTNER_KEY === 'true',
  };
}

/** True when this raw key is one of the issued ones. Compares hashes, in constant time. */
export function isIssuedKey(rawKey: string, hashes: Buffer[]): boolean {
  const presented = Buffer.from(sha256Hex(rawKey), 'hex');
  // Check every hash even after a match, so the time taken does not say which one matched.
  return hashes.reduce((found, hash) => (timingSafeEqual(presented, hash) ? true : found), false);
}

export type PartnerAccess =
  | { ok: true; via: 'open' | 'partner-key' | 'organiser' }
  | { ok: false; response: NextResponse<ErrorBody> };

const unauthorized = (): PartnerAccess => ({
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

  if (config.hashes.length === 0 && config.ignored === 0 && !config.required) {
    if (!g[WARNED]) {
      g[WARNED] = true;
      console.warn('WARNING: no partner keys are configured, so the partner endpoints are OPEN to anyone. Set PARTNER_KEYS (npm run partner:key) before deploying.');
    }
    return { ok: true, via: 'open' };
  }
  if (config.hashes.length === 0 && !g[WARNED]) {
    // Something was configured, but nothing usable (a typo, or a raw key pasted where its hash belongs).
    // That must not quietly open the door: every partner call is refused until it is fixed.
    g[WARNED] = true;
    console.error(
      config.ignored > 0
        ? `PARTNER_KEYS has ${config.ignored} entr${config.ignored === 1 ? 'y' : 'ies'} but none is a 64-character SHA-256 hash, so every partner call is refused. Store the hash that "npm run partner:key" prints, not the key.`
        : 'REQUIRE_PARTNER_KEY is true but PARTNER_KEYS is empty, so every partner call is refused.',
    );
  }

  const key = req.headers.get('x-api-key')?.trim();
  if (key && key.length <= 200 && isIssuedKey(key, config.hashes)) return { ok: true, via: 'partner-key' };

  if (opts.allowOrganiser && bearerToken(req)) {
    const organiser = await requireUser(req);
    if (organiser.ok) return { ok: true, via: 'organiser' };
  }
  return unauthorized();
}
