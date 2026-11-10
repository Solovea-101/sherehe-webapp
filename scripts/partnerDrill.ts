/**
 * The Week 10 demo drill, as one command: `npm run drill`.
 *
 * Calls Sherehe's own GET /api/training-options (which reads Ujuzi on the server) every couple of
 * seconds and prints one line each time. Run it, then have Ujuzi stop and restart, and watch the three
 * steps the handout asks you to rehearse: live data, then our friendly message while Ujuzi is down,
 * then live data again, with no change to our code.
 *
 *   SHEREHE_URL        our server (default http://localhost:3000)
 *   DRILL_EMAIL, DRILL_PASSWORD
 *                      an organiser to log in as. When they are not set the script registers a throwaway
 *                      organiser, which is fine on your own computer and not something to do on a live site.
 *   DRILL_EVERY_MS     pause between calls (default 2000)
 *   DRILL_ROUNDS       stop after this many calls (default: run until Ctrl-C)
 *   DRILL_FRESH        default on. Sherehe remembers a successful course read for 5 minutes, so the same
 *                      call repeated would keep showing saved data for up to 5 minutes after Ujuzi stops,
 *                      and hide the outage. Fresh mode asks for a different category and county each time,
 *                      so every call really goes to Ujuzi. Set DRILL_FRESH=false to repeat one call and
 *                      see what a user reloading the same page sees.
 *
 * It prints status, time and what the user would see. It never prints the token or any key.
 */

const base = (process.env.SHEREHE_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
const everyMs = Number(process.env.DRILL_EVERY_MS) > 0 ? Number(process.env.DRILL_EVERY_MS) : 2000;
const rounds = Number(process.env.DRILL_ROUNDS) > 0 ? Number(process.env.DRILL_ROUNDS) : Infinity;

interface Reply { status: number; body: unknown }

const fresh = process.env.DRILL_FRESH !== 'false';
const CATEGORIES = ['catering', 'events', 'security', 'cleaning', 'accommodation', 'electrical', 'plumbing', 'tutoring', 'campus'];
const COUNTIES = ['Nairobi', 'Mombasa', 'Kisumu', 'Nakuru', 'Kiambu', 'Kilifi', 'Uasin Gishu', 'Nyeri', 'Machakos', 'Kajiado',
  'Kakamega', 'Bungoma', 'Meru', 'Embu', 'Garissa', 'Turkana', 'Laikipia', 'Narok', 'Kericho', 'Nyandarua'];

/** Call number i: one fixed question, or (fresh mode) a new category and county each time, 180 before any repeats. */
function questionFor(i: number): { category: string; county: string } {
  if (!fresh) return { category: 'catering', county: 'Nairobi' };
  return { category: CATEGORIES[i % CATEGORIES.length], county: COUNTIES[Math.floor(i / CATEGORIES.length) % COUNTIES.length] };
}

async function send(method: string, path: string, token?: string, body?: unknown): Promise<Reply> {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let parsed: unknown = text;
  try { parsed = JSON.parse(text); } catch { /* not JSON: keep the text */ }
  return { status: res.status, body: parsed };
}

const tokenOf = (body: unknown): string | undefined =>
  typeof body === 'object' && body !== null && 'token' in body && typeof (body as { token: unknown }).token === 'string'
    ? (body as { token: string }).token : undefined;

async function login(): Promise<string> {
  const email = process.env.DRILL_EMAIL;
  const password = process.env.DRILL_PASSWORD;
  if (email && password) {
    const res = await send('POST', '/api/auth/login', undefined, { email, password });
    const token = tokenOf(res.body);
    if (res.status !== 200 || !token) throw new Error(`login as ${email} answered ${res.status}`);
    return token;
  }
  const res = await send('POST', '/api/auth/register', undefined, { email: `drill.${Date.now()}@example.com`, name: 'Drill', password: 'Drill-pass-2026' });
  const token = tokenOf(res.body);
  if (res.status !== 201 || !token) throw new Error(`could not register a throwaway organiser (${res.status}); set DRILL_EMAIL and DRILL_PASSWORD`);
  return token;
}

const messageOf = (body: unknown): string =>
  typeof body === 'object' && body !== null && 'message' in body ? String((body as { message: unknown }).message) : String(body).slice(0, 80);

async function main(): Promise<void> {
  const token = await login();
  console.log(`Drilling ${base}/api/training-options every ${everyMs} ms (${fresh ? 'a new category and county each call, so none is served from memory' : 'the same call each time, so saved answers can show'}). Stop and restart Ujuzi now. Ctrl-C to finish.\n`);
  let previous = '';
  for (let i = 1; i <= rounds; i++) {
    const t0 = Date.now();
    const q = questionFor(i - 1);
    let line: string;
    let state: string;
    try {
      const res = await send('GET', `/api/training-options?category=${q.category}&county=${encodeURIComponent(q.county)}`, token);
      const ms = Date.now() - t0;
      if (res.status === 200 && Array.isArray(res.body)) { state = 'LIVE'; line = `${res.body.length} course(s) from Ujuzi for ${q.category} in ${q.county}`; }
      else { state = 'DEGRADED'; line = `the user sees: "${messageOf(res.body)}"`; }
      console.log(`${new Date().toISOString().slice(11, 19)}  HTTP ${res.status}  ${String(ms).padStart(5)} ms  ${state.padEnd(8)} ${line}`);
    } catch (err) {
      state = 'NO ANSWER';
      console.log(`${new Date().toISOString().slice(11, 19)}  our own server did not answer: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (previous && state !== previous) console.log(`          ^ changed from ${previous} to ${state}`);
    previous = state;
    if (i < rounds) await new Promise((r) => setTimeout(r, everyMs));
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
