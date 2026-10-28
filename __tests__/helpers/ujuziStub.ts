/**
 * A tiny local Ujuzi, built from the examples in partner-tests/ujuzi_openapi.yaml, so tests (and
 * `npm run verify`) never need the real partner. It behaves like the contract describes and can
 * also misbehave on command, to prove that Sherehe copes: down, slow, refusing our key, answering
 * rubbish, redirecting, or sending a shape that does not match the contract.
 *
 * It is a stand-in for the DRAFT contract. When Ujuzi hands off its real openapi.yaml, check this
 * file against it.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';

export type StubMode = 'ok' | 'down' | 'slow' | 'error500' | 'unauthorized' | 'garbage' | 'wrongShape' | 'redirect' | 'rateLimited';

export interface StubCall {
  method: string;
  path: string; // path and query, as received
  apiKey: string | undefined;
  body: unknown;
}

interface Booking {
  id: string;
  courseId: string;
  eventName: string;
  crewSize: number;
  preferredStart: string;
  status: 'pending' | 'confirmed' | 'declined';
  createdAt: string;
}

const COURSES = [
  { id: 'crs_501', title: 'Food hygiene and event service', category: 'catering', centre: { id: 'cen_11', name: 'Westlands Skills Centre' },
    county: 'Nairobi', area: 'Westlands', durationWeeks: 2, feeKes: 3500, nextStart: '2026-11-23T07:00:00Z', certificateLevel: 'short-course' },
  { id: 'crs_502', title: 'Event security basics', category: 'security', centre: { id: 'cen_12', name: 'Parklands Training Hub' },
    county: 'Nairobi', area: 'Parklands', durationWeeks: 3, feeKes: 4500, nextStart: '2026-12-01T07:00:00Z', certificateLevel: 'short-course' },
  { id: 'crs_503', title: 'Hospitality front of house', category: 'events', centre: { id: 'cen_21', name: 'Nyali Hospitality Centre' },
    county: 'Mombasa', area: 'Nyali', durationWeeks: 4, feeKes: 5200, nextStart: '2026-12-07T07:00:00Z', certificateLevel: 'grade-III' },
  { id: 'crs_504', title: 'Commercial cleaning', category: 'cleaning', centre: { id: 'cen_31', name: 'Milimani Skills Centre' },
    county: 'Kisumu', area: 'Milimani', durationWeeks: 2, feeKes: 2800, nextStart: '2026-11-30T07:00:00Z', certificateLevel: 'short-course' },
];
const CATEGORIES = ['accommodation', 'campus', 'catering', 'cleaning', 'electrical', 'events', 'plumbing', 'security', 'tutoring'];

const CERTIFICATES: { [no: string]: object } = {
  'UJZ-2026-00123': { certificateNo: 'UJZ-2026-00123', valid: true, courseTitle: 'Food hygiene and event service', level: 'short-course', issuedOn: '2026-08-14', holder: 'Achieng O.' },
  'UJZ-2026-00124': { certificateNo: 'UJZ-2026-00124', valid: false, courseTitle: 'Event security basics', level: 'short-course', issuedOn: '2026-05-02', holder: 'Brian K.' },
};

export interface UjuziStub {
  /** Base URL to put in UJUZI_API_URL. */
  url: string;
  calls: StubCall[];
  mode: StubMode;
  /** How long 'slow' mode waits before answering. */
  slowMs: number;
  /** When set, requests without this X-API-Key get 401. */
  requireKey: string | undefined;
  /** When true, every course carries a field Ujuzi's contract does not list (contract drift). */
  extraCourseField: boolean;
  bookings: Map<string, Booking>;
  /** What the training centre's staff do on Ujuzi's website: confirm or decline a pending booking. */
  decide: (bookingId: string, status: 'confirmed' | 'declined') => void;
  /** Back to a well-behaved Ujuzi with no bookings (ids keep counting up). */
  reset: () => void;
  close: () => Promise<void>;
}

/** Stands in for a request body that was not JSON, so the route can answer 400 as the contract says. */
const BAD_JSON = Symbol('bad json');
const NEW_BOOKING_FIELDS = ['courseId', 'crewSize', 'preferredStart', 'eventName'];
const BOOKING_UPDATE_FIELDS = ['crewSize', 'preferredStart'];
/** The contract's NewBooking and BookingUpdate forbid fields it does not list (additionalProperties: false). */
const unknownField = (body: unknown, allowed: string[]): string | undefined =>
  typeof body === 'object' && body !== null ? Object.keys(body).find((k) => !allowed.includes(k)) : undefined;

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

export async function startUjuziStub(opts: { requireKey?: string } = {}): Promise<UjuziStub> {
  let nextBooking = 6001;
  const timers = new Set<NodeJS.Timeout>(); // pending 'slow' answers, cancelled on reset and close
  const stub: UjuziStub = {
    url: '',
    calls: [],
    mode: 'ok',
    slowMs: 1500,
    requireKey: opts.requireKey,
    extraCourseField: false,
    bookings: new Map(),
    decide: (id, status) => {
      const booking = stub.bookings.get(id);
      if (!booking) throw new Error(`stub has no booking ${id}`);
      booking.status = status;
    },
    reset: () => {
      timers.forEach(clearTimeout);
      timers.clear();
      stub.calls.length = 0;
      stub.mode = 'ok';
      stub.slowMs = 1500;
      stub.requireKey = opts.requireKey;
      stub.extraCourseField = false;
      stub.bookings.clear();
      // The id counter is NOT reset: a real Ujuzi never reuses a booking id, and Sherehe's records
      // from earlier tests in the same file still point at the old ones.
    },
    close: () => new Promise((resolve) => {
      timers.forEach(clearTimeout);
      timers.clear();
      server.closeAllConnections();
      server.close(() => resolve());
    }),
  };

  const send = (res: http.ServerResponse, status: number, body?: unknown) => {
    res.statusCode = status;
    if (body === undefined) return res.end();
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(body));
  };
  const message = (res: http.ServerResponse, status: number, text: string) => send(res, status, { message: text });

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      let body: unknown;
      let badJson = false;
      try {
        body = raw ? JSON.parse(raw) : undefined;
      } catch {
        badJson = true;
      }
      const apiKey = req.headers['x-api-key'];
      stub.calls.push({ method: req.method ?? 'GET', path: req.url ?? '/', apiKey: typeof apiKey === 'string' ? apiKey : undefined, body });

      const respond = () => route(req, res, badJson ? BAD_JSON : body);
      switch (stub.mode) {
        case 'down':
          return req.socket.destroy();
        case 'slow':
          return void timers.add(setTimeout(respond, stub.slowMs));
        case 'error500':
          return message(res, 500, 'internal explosion');
        case 'unauthorized':
          return message(res, 401, 'Send your partner key as X-API-Key');
        case 'rateLimited':
          // Ujuzi 0.3.0 limits each caller; a 429 means the request was not carried out.
          res.setHeader('Retry-After', '30');
          return message(res, 429, 'Too many requests. Wait a little and try again.');
        case 'garbage':
          res.setHeader('Content-Type', 'text/html');
          return void res.end('<html><body>Render is waking up...</body></html>');
        case 'redirect':
          res.statusCode = 302;
          res.setHeader('Location', 'http://elsewhere.invalid/');
          return void res.end();
        case 'wrongShape':
          return send(res, 200, req.url?.startsWith('/api/courses') ? [{ id: 'crs_1', title: 'No other fields' }] : { id: 'x' });
        default:
          return respond();
      }
    });
  });

  function route(req: http.IncomingMessage, res: http.ServerResponse, body: unknown) {
    if (stub.requireKey && req.headers['x-api-key'] !== stub.requireKey) {
      return message(res, 401, 'Send your partner key as X-API-Key');
    }
    const url = new URL(req.url ?? '/', 'http://stub');
    const parts = url.pathname.split('/').filter(Boolean); // ['api', 'bookings', 'bkg_6001']
    const method = req.method ?? 'GET';
    if (parts[0] !== 'api') return message(res, 404, 'No such endpoint');

    // ---- S1: courses
    if (parts[1] === 'courses' && method === 'GET') {
      if (parts[2]) {
        const course = COURSES.find((c) => c.id === parts[2]);
        return course ? send(res, 200, course) : message(res, 404, `Course ${parts[2]} not found`);
      }
      const category = url.searchParams.get('category');
      const county = url.searchParams.get('county');
      if (category && !CATEGORIES.includes(category)) return message(res, 400, 'category is not one of the shared categories');
      const matching = COURSES.filter((c) => (!category || c.category === category) && (!county || c.county.toLowerCase() === county.toLowerCase()));
      return send(res, 200, stub.extraCourseField ? matching.map((c) => ({ ...c, rating: 5 })) : matching);
    }

    // ---- S2: certificates
    if (parts[1] === 'certificates' && parts[2] && method === 'GET') {
      if (!/^UJZ-\d{4}-\d{5}$/.test(parts[2])) return message(res, 400, 'certificateNo must look like UJZ-2026-00123');
      const found = CERTIFICATES[parts[2]];
      return found ? send(res, 200, found) : message(res, 404, `Certificate ${parts[2]} not found`);
    }

    // ---- S3: create a booking
    if (parts[1] === 'bookings' && !parts[2] && method === 'POST') {
      if (body === BAD_JSON) return message(res, 400, 'The request body is not valid JSON');
      const extra = unknownField(body, NEW_BOOKING_FIELDS);
      if (extra) return message(res, 400, `Unknown field "${extra}"`);
      const b = (typeof body === 'object' && body !== null ? body : {}) as { [k: string]: unknown };
      if (!COURSES.some((c) => c.id === b.courseId)) return message(res, 404, `Course ${String(b.courseId)} not found`);
      if (!Number.isInteger(b.crewSize) || (b.crewSize as number) < 1 || (b.crewSize as number) > 40) return message(res, 400, 'crewSize must be a whole number from 1 to 40');
      if (typeof b.preferredStart !== 'string' || !ISO_UTC.test(b.preferredStart) || Date.parse(b.preferredStart) <= Date.now()) {
        return message(res, 400, 'preferredStart must be a future date-time, for example 2026-11-28T08:00:00Z');
      }
      if (typeof b.eventName !== 'string' || b.eventName === '' || b.eventName.length > 120) return message(res, 400, 'eventName must be 1 to 120 characters');
      // Ujuzi's contract (0.1.1 onwards): a second pending booking of the same course and event name,
      // ignoring case and surrounding spaces, is a 409.
      const sameName = (a: string, c: string) => a.trim().toLowerCase() === c.trim().toLowerCase();
      for (const other of stub.bookings.values()) {
        if (other.status === 'pending' && other.courseId === b.courseId && sameName(other.eventName, b.eventName)) {
          return message(res, 409, `A pending booking named "${other.eventName}" already exists for course ${other.courseId}`);
        }
      }
      const booking: Booking = {
        id: `bkg_${nextBooking++}`, courseId: b.courseId as string, eventName: b.eventName, crewSize: b.crewSize as number,
        preferredStart: b.preferredStart, status: 'pending', createdAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      };
      stub.bookings.set(booking.id, booking);
      res.setHeader('Location', `/api/bookings/${booking.id}`);
      return send(res, 201, booking);
    }

    // ---- S4, S5: one booking
    if (parts[1] === 'bookings' && parts[2]) {
      const booking = stub.bookings.get(parts[2]);
      if (!booking) return message(res, 404, `Booking ${parts[2]} not found`);
      if (method === 'GET') return send(res, 200, booking);
      if (booking.status !== 'pending') return message(res, 409, `Booking ${booking.id} is ${booking.status}; only pending bookings can be changed`);
      if (method === 'DELETE') {
        stub.bookings.delete(booking.id);
        return send(res, 204);
      }
      if (method === 'PUT') {
        if (body === BAD_JSON) return message(res, 400, 'The request body is not valid JSON');
        const extra = unknownField(body, BOOKING_UPDATE_FIELDS);
        if (extra) return message(res, 400, `Unknown field "${extra}"`);
        const b = (typeof body === 'object' && body !== null ? body : {}) as { [k: string]: unknown };
        if (!Number.isInteger(b.crewSize) || (b.crewSize as number) < 1 || (b.crewSize as number) > 40) return message(res, 400, 'crewSize must be a whole number from 1 to 40');
        if (typeof b.preferredStart !== 'string' || !ISO_UTC.test(b.preferredStart) || Date.parse(b.preferredStart) <= Date.now()) {
          return message(res, 400, 'preferredStart must be a future date-time, for example 2026-11-28T08:00:00Z');
        }
        booking.crewSize = b.crewSize as number;
        booking.preferredStart = b.preferredStart;
        return send(res, 200, booking);
      }
    }
    return message(res, 404, 'No such endpoint');
  }

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  stub.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return stub;
}
