/**
 * A stand-in for Ujuzi that misbehaves on command, for the Week 11 resilience drills. Run it with
 * `npm run flaky`, point Sherehe at it (UJUZI_API_URL=http://localhost:4000) and switch its behaviour
 * without restarting:
 *
 *   curl http://localhost:4000/__mode/slow      answers after SLOW_MS (default 10 s)
 *   curl http://localhost:4000/__mode/flaky     fails twice with 503, then works, and so on
 *   curl http://localhost:4000/__mode/error     always answers 500
 *   curl http://localhost:4000/__mode/limited   always answers 429 with Retry-After: 2
 *   curl http://localhost:4000/__mode/ok        back to normal
 *
 * It answers the few calls Sherehe makes, in Ujuzi's contract shapes (partner-tests/ujuzi_openapi.yaml,
 * 0.4.0): GET /api/courses, GET /api/courses/{id}, GET /api/certificates/{no} and POST /api/bookings.
 * Every call is printed with its number and the mode, so you can count how many times a page load
 * reached the partner. It is a separate little program, not part of the app.
 *
 *   PORT (default 4000)   SLOW_MS (default 10000)
 */
import { createServer } from 'node:http';

type Mode = 'ok' | 'slow' | 'flaky' | 'error' | 'limited';
const MODES: readonly Mode[] = ['ok', 'slow', 'flaky', 'error', 'limited'];

let mode: Mode = 'ok';
let calls = 0;
const slowMs = Number(process.env.SLOW_MS) > 0 ? Number(process.env.SLOW_MS) : 10_000;

const courses = [
  { id: 'crs_501', title: 'Food hygiene and event service', category: 'catering', centre: { id: 'cen_11', name: 'Westlands Skills Centre' }, county: 'Nairobi', area: 'Westlands', durationWeeks: 2, feeKes: 3500, nextStart: '2026-12-01T07:00:00Z', certificateLevel: 'short-course' },
  { id: 'crs_502', title: 'Event security basics', category: 'security', centre: { id: 'cen_12', name: 'Parklands Training Hub' }, county: 'Nairobi', area: 'Parklands', durationWeeks: 3, feeKes: 4500, nextStart: '2026-12-08T07:00:00Z', certificateLevel: 'short-course' },
  { id: 'crs_503', title: 'Ushering and guest care', category: 'events', centre: { id: 'cen_11', name: 'Westlands Skills Centre' }, county: 'Nairobi', area: 'Westlands', durationWeeks: 2, feeKes: 3000, nextStart: '2026-12-15T07:00:00Z', certificateLevel: 'short-course' },
  { id: 'crs_504', title: 'Venue cleaning crews', category: 'cleaning', centre: { id: 'cen_21', name: 'Nyali Skills Centre' }, county: 'Mombasa', area: 'Nyali', durationWeeks: 2, feeKes: 2600, nextStart: '2026-12-10T07:00:00Z', certificateLevel: 'short-course' },
];

function send(res: import('node:http').ServerResponse, status: number, body?: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(body === undefined ? undefined : JSON.stringify(body));
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname;

  // The control switch is not a call to the partner, so it is not counted.
  const switchTo = /^\/__mode\/(\w+)$/.exec(path);
  if (switchTo) {
    const wanted = switchTo[1] as Mode;
    if (!MODES.includes(wanted)) return send(res, 400, { message: `mode must be one of ${MODES.join(', ')}` });
    mode = wanted;
    calls = 0;
    console.log(`--- mode is now ${mode}`);
    return send(res, 200, { mode });
  }

  void (async () => {
    calls += 1;
    console.log(`${req.method} ${path} (call ${calls}, mode ${mode})`);
    if (mode === 'slow') await new Promise((r) => setTimeout(r, slowMs));
    if (mode === 'flaky' && calls % 3 !== 0) return send(res, 503, { message: 'Try again' });
    if (mode === 'error') return send(res, 500, { message: 'Internal error' });
    if (mode === 'limited') return send(res, 429, { message: 'Too many requests' }, { 'Retry-After': '2' });

    if (req.method === 'GET' && path === '/api/courses') {
      const category = url.searchParams.get('category');
      const county = url.searchParams.get('county')?.toLowerCase();
      return send(res, 200, courses.filter((c) => (!category || c.category === category) && (!county || c.county.toLowerCase() === county)));
    }
    const one = /^\/api\/courses\/(\w+)$/.exec(path);
    if (req.method === 'GET' && one) {
      const found = courses.find((c) => c.id === one[1]);
      return found ? send(res, 200, found) : send(res, 404, { message: `Course ${one[1]} not found` });
    }
    const cert = /^\/api\/certificates\/([\w-]+)$/.exec(path);
    if (req.method === 'GET' && cert) {
      if (cert[1] !== 'UJZ-2026-00123') return send(res, 404, { message: `Certificate ${cert[1]} not found` });
      return send(res, 200, { certificateNo: 'UJZ-2026-00123', valid: true, courseTitle: 'Food hygiene and event service', level: 'short-course', issuedOn: '2026-08-14', holder: 'Achieng O.' });
    }
    if (req.method === 'POST' && path === '/api/bookings') {
      return send(res, 201, { id: `bkg_${9000 + calls}`, courseId: 'crs_501', eventName: 'Drill event', crewSize: 2, preferredStart: '2026-12-02T08:00:00Z', status: 'pending', createdAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z') }, { Location: '/api/bookings/bkg_9001' });
    }
    return send(res, 404, { message: `No endpoint ${req.method} ${path}` });
  })();
});

const port = Number(process.env.PORT) > 0 ? Number(process.env.PORT) : 4000;
server.listen(port, () => console.log(`Stand-in partner on http://localhost:${port} (mode ${mode}, slow = ${slowMs} ms)`));
