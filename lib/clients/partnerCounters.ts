/**
 * How often calls to a partner needed help, kept in memory and shown by GET /api/stats (Week 12). They tell you
 * how often Ujuzi is really failing without anyone watching the log. They reset when the server restarts, and
 * they are per server copy, which is fine here and not for several copies behind one address.
 *
 *   attempts     every try sent to the partner (a retry is another try)
 *   retries      tries made again after one failed
 *   savedCopies  answers that were a flagged saved copy because every try failed
 *   unavailable  answers that failed with our own 502 (every try failed and nothing was saved)
 */
export interface PartnerCounts {
  attempts: number;
  retries: number;
  savedCopies: number;
  unavailable: number;
}

// Kept on globalThis, like the store and the partner memory: Next.js can load this module once per route
// bundle, and the numbers must be one set, whichever bundle counted them.
const COUNTERS = Symbol.for('sherehe.partnerCounters');
const holder = globalThis as typeof globalThis & { [COUNTERS]?: { [partner: string]: PartnerCounts } };
const all: { [partner: string]: PartnerCounts } = (holder[COUNTERS] ??= {});

const empty = (): PartnerCounts => ({ attempts: 0, retries: 0, savedCopies: 0, unavailable: 0 });

export function countPartner(partner: string, what: keyof PartnerCounts): void {
  const key = partner.toLowerCase();
  (all[key] ??= empty())[what] += 1;
}

/** A copy of every partner's counts. Ujuzi is always listed, so a quiet partner reads as zeros, not as missing. */
export function readPartnerCounts(): { [partner: string]: PartnerCounts } {
  const out: { [partner: string]: PartnerCounts } = { ujuzi: empty() };
  for (const [partner, counts] of Object.entries(all)) out[partner] = { ...counts };
  return out;
}

/** For tests. */
export function resetPartnerCounts(): void {
  for (const key of Object.keys(all)) delete all[key];
}
