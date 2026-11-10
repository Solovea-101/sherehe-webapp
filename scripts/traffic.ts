/**
 * Sends a random mix of requests to Sherehe's API, to give the request log and GET /api/stats something to show
 * (Week 12). Read-only: it only ever sends GETs. Run it yourself, and give the same script to a partner to run
 * against your URL with the key you issued them.
 *
 *   API=http://localhost:3000 KEY=<a partner key> npm run traffic
 *
 *   API    where Sherehe is (default http://localhost:3000)
 *   KEY    a partner key. Never printed. Without it only the calls that need no key are meaningful
 *   N      how many requests (default 60)
 *   PAUSE  milliseconds between requests (default 50). Lower it and the rate limit (300 a minute for a partner,
 *          100 a minute for everyone else, per address) will answer 429. That is data too
 *
 * The mix has good requests, an event that does not exist, an unknown county, a request with no key, one with a
 * wrong key, and a path that does not exist. Adapt it if the API changes.
 */
// An empty export makes this file a module, so its names do not clash with the other scripts' (a file with no
// import or export is a global script to TypeScript).
export {};

const api = (process.env.API ?? 'http://localhost:3000').replace(/\/+$/, '');
const key = process.env.KEY;
const n = Number(process.env.N) > 0 ? Number(process.env.N) : 60;
const pauseMs = Number(process.env.PAUSE) >= 0 && process.env.PAUSE !== undefined ? Number(process.env.PAUSE) : 50;

interface Kind {
  label: string;
  path: string;
  header: 'key' | 'none' | 'wrong';
}

const mix: Kind[] = [
  { label: 'upcoming events', path: '/api/events?status=upcoming', header: 'key' },
  { label: 'upcoming events', path: '/api/events?status=upcoming', header: 'key' },
  { label: 'events in one county', path: '/api/events?status=upcoming&county=Nairobi', header: 'key' },
  { label: 'events with their roles', path: '/api/events?status=upcoming&include=roles', header: 'key' },
  { label: 'one event', path: '/api/events/evt_2001', header: 'key' },
  { label: 'an event’s roles', path: '/api/events/evt_2001/roles', header: 'key' },
  { label: 'no such event (404)', path: '/api/events/evt_9999', header: 'key' },
  { label: 'no such offer (404)', path: '/api/offers/ofr_9999', header: 'key' },
  { label: 'unknown county (400)', path: '/api/events?status=upcoming&county=Narnia', header: 'key' },
  { label: 'no key at all (401)', path: '/api/events?status=upcoming', header: 'none' },
  { label: 'a wrong key (401)', path: '/api/events?status=upcoming', header: 'wrong' },
  { label: 'a path that does not exist (404)', path: '/api/not-a-route', header: 'key' },
];

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  if (!key) console.warn('KEY is not set: every call that needs a key will be answered 401.');
  const byStatus: { [status: string]: number } = {};
  const byKind: { [label: string]: { [status: string]: number } } = {};
  for (let i = 0; i < n; i++) {
    const kind = mix[Math.floor(Math.random() * mix.length)];
    const headers: { [name: string]: string } = {};
    if (kind.header === 'key' && key) headers['X-API-Key'] = key;
    if (kind.header === 'wrong') headers['X-API-Key'] = 'wrong-key';
    let status: string;
    try {
      const res = await fetch(api + kind.path, { headers, signal: AbortSignal.timeout(15_000) });
      status = String(res.status);
      await res.arrayBuffer();
    } catch {
      status = 'failed';
    }
    byStatus[status] = (byStatus[status] ?? 0) + 1;
    const k = (byKind[kind.label] ??= {});
    k[status] = (k[status] ?? 0) + 1;
    await pause(pauseMs);
  }
  console.log(`Sent ${n} read-only requests to ${api}.`);
  console.log('Status codes received:', byStatus);
  for (const [label, counts] of Object.entries(byKind).sort()) console.log(`  ${label}:`, counts);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
