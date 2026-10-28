import { timingSafeEqual } from 'node:crypto';
import { sha256Hex } from '@/lib/auth/hash';
import { DEFAULT_PARTNER } from '@/lib/db/types';

// Plain settings code, kept apart from partnerKey.ts so that server.ts and the rate limiter can use it
// without loading Next.js's request code.
/**
 * Partner keys (R4). A consuming system proves who it is with an X-API-Key header. Sherehe keeps only
 * the SHA-256 of each key it has issued, never the key itself, so a leaked environment or database
 * cannot be used to call us. Keys are made with `npm run partner:key -- --name kazi`.
 *
 * PARTNER_KEYS is comma-separated and each entry is `name:hash`, for example `kazi:3b1f...`. The name
 * is the consumer, and it is what offers are filed under: another consumer's offer answers 404.
 * Several entries may share a name, so a key can be rotated with the old and new key both live.
 * An entry without a name, or with something other than a 64-character hash, never matches.
 *
 * Fail closed: with no usable key every partner call is refused (401), in every environment, and the
 * log says so. The only way to leave the partner API open is ALLOW_OPEN_PARTNER_API=true, which the
 * test suite sets and which is ignored when NODE_ENV is production.
 */
const HEX_SHA256 = /^[0-9a-f]{64}$/;
const NAME = /^[a-z][a-z0-9_-]{0,31}$/;

/** The name an offer is filed under when the partner API is deliberately left open (the tests). */
export const OPEN_PARTNER = DEFAULT_PARTNER;

export interface PartnerKey {
  name: string;
  hash: Buffer;
}

export interface PartnerKeyConfig {
  keys: PartnerKey[];
  /** PARTNER_KEYS entries that are not `name:64-hex-hash`, so they can never match. */
  ignored: number;
  /** ALLOW_OPEN_PARTNER_API=true outside production: partner calls need no key. */
  open: boolean;
  /** ALLOW_OPEN_PARTNER_API=true in production, which is refused. */
  openRefused: boolean;
}

/** Reads the settings now; they are looked at on every request. */
export function readPartnerKeyConfig(env: { [name: string]: string | undefined } = process.env): PartnerKeyConfig {
  const entries = (env.PARTNER_KEYS ?? '').split(',').map((e) => e.trim()).filter(Boolean);
  const keys: PartnerKey[] = [];
  for (const entry of entries) {
    const colon = entry.indexOf(':');
    const name = colon > 0 ? entry.slice(0, colon).trim().toLowerCase() : '';
    const hash = colon > 0 ? entry.slice(colon + 1).trim().toLowerCase() : '';
    if (NAME.test(name) && HEX_SHA256.test(hash)) keys.push({ name, hash: Buffer.from(hash, 'hex') });
  }
  const wantsOpen = env.ALLOW_OPEN_PARTNER_API === 'true';
  const production = env.NODE_ENV === 'production';
  return { keys, ignored: entries.length - keys.length, open: wantsOpen && !production, openRefused: wantsOpen && production };
}

/** The name of the consumer this raw key was issued to, or null. Compares hashes, in constant time. */
export function findIssuedKey(rawKey: string, keys: PartnerKey[]): string | null {
  const presented = Buffer.from(sha256Hex(rawKey), 'hex');
  // Check every hash even after a match, so the time taken does not say which one matched.
  let found: string | null = null;
  for (const key of keys) if (timingSafeEqual(presented, key.hash) && found === null) found = key.name;
  return found;
}

/** What to tell the log, once, about how the partner API is set up. */
export function describePartnerKeys(config: PartnerKeyConfig = readPartnerKeyConfig()): { level: 'log' | 'warn' | 'error'; text: string } {
  const names = [...new Set(config.keys.map((k) => k.name))];
  const bad = config.ignored > 0 ? ` ${config.ignored} PARTNER_KEYS entr${config.ignored === 1 ? 'y is' : 'ies are'} not name:hash and ignored.` : '';
  if (config.openRefused) {
    return { level: 'error', text: `ALLOW_OPEN_PARTNER_API is ignored in production. Partner keys loaded: ${config.keys.length}${names.length ? ` (${names.join(', ')})` : ''}.${bad}` };
  }
  if (config.open && config.keys.length === 0 && config.ignored === 0) {
    return { level: 'warn', text: `WARNING: ALLOW_OPEN_PARTNER_API=true, so the partner endpoints are OPEN to anyone. Never set it on a deployment. Partner keys loaded: ${config.keys.length}.` };
  }
  if (config.keys.length === 0) {
    return { level: 'warn', text: `Partner keys loaded: 0, so every partner call is refused (401). Set PARTNER_KEYS=name:hash (npm run partner:key -- --name kazi).${bad}` };
  }
  return { level: bad ? 'warn' : 'log', text: `Partner keys loaded: ${config.keys.length} (${names.join(', ')}).${bad}` };
}
