/**
 * The only file that knows Ujuzi: its URL (UJUZI_API_URL), our key at Ujuzi (UJUZI_API_KEY), its
 * paths and its field names. Everything else in Sherehe calls these functions and gets Ujuzi's
 * shapes back, typed from types/ujuzi.d.ts (lib/mappers.ts turns them into ours).
 *
 * Every answer is checked against Ujuzi's contract before it leaves this file. An answer that does
 * not match (a missing field, an unknown status) is treated like Ujuzi being down: 502 for our
 * clients, never half-empty data in a page.
 */
import type { components } from '@/types/ujuzi';
import { CACHE_TTL_MS, PartnerRejectedError, PartnerUnavailableError, partnerFetch, type PartnerResponse } from './fetcher';

type Schemas = components['schemas'];
export type UjuziCourse = Schemas['Course'];
export type UjuziBooking = Schemas['Booking'];
export type UjuziCertificate = Schemas['CertificateCheck'];

const PARTNER = 'Ujuzi';

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const CATEGORIES = ['accommodation', 'campus', 'catering', 'cleaning', 'electrical', 'events', 'plumbing', 'security', 'tutoring'] as const;
const LEVELS = ['short-course', 'grade-III', 'grade-II', 'grade-I'] as const;
const BOOKING_STATUSES = ['pending', 'confirmed', 'declined'] as const;
// Compile-time: these lists are exactly Ujuzi's enums, so a changed contract fails `npm run typecheck`.
export const _ujuziCategories: Same<(typeof CATEGORIES)[number], UjuziCourse['category']> = true;
export const _ujuziLevels: Same<(typeof LEVELS)[number], UjuziCourse['certificateLevel']> = true;
export const _ujuziStatuses: Same<(typeof BOOKING_STATUSES)[number], UjuziBooking['status']> = true;

// ---- talking to Ujuzi ------------------------------------------------------------------------

export interface UjuziOptions {
  /** The poller is not in a hurry: allow Ujuzi a minute to wake up. */
  background?: boolean;
}

function url(path: string, query?: { [name: string]: string | undefined }): string {
  const raw = process.env.UJUZI_API_URL?.trim();
  if (!raw) throw new PartnerUnavailableError(PARTNER, 'Ujuzi is not configured (UJUZI_API_URL is empty)');
  let base: URL;
  try {
    base = new URL(raw);
  } catch {
    throw new PartnerUnavailableError(PARTNER, 'Ujuzi is not configured (UJUZI_API_URL is not a URL)');
  }
  if (base.protocol !== 'http:' && base.protocol !== 'https:') {
    throw new PartnerUnavailableError(PARTNER, 'Ujuzi is not configured (UJUZI_API_URL must be http or https)');
  }
  const target = new URL(path, base.origin + base.pathname.replace(/\/+$/, '') + '/');
  for (const [name, value] of Object.entries(query ?? {})) {
    if (value !== undefined) target.searchParams.set(name, value);
  }
  return target.toString();
}

function call(
  path: string,
  init: { method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; body?: unknown; query?: { [name: string]: string | undefined }; cache?: boolean; serveStale?: boolean } & UjuziOptions = {},
): Promise<PartnerResponse> {
  const key = process.env.UJUZI_API_KEY?.trim();
  return partnerFetch({
    partner: PARTNER,
    method: init.method,
    url: url(path.replace(/^\//, ''), init.query),
    headers: key ? { 'X-API-Key': key } : undefined,
    body: init.body,
    background: init.background,
    cacheTtlMs: init.cache ? CACHE_TTL_MS : 0,
    serveStale: init.serveStale,
  });
}

// ---- checking Ujuzi's answers ----------------------------------------------------------------

type Json = { [key: string]: unknown };
const isJson = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === 'string' && v !== '';
const isWhole = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const isTime = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v));
const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => list.some((item) => item === v);
const mismatch = (what: string): never => {
  throw new PartnerUnavailableError(PARTNER, `Ujuzi sent a ${what} that does not match its contract`);
};

function parseCourse(v: unknown): UjuziCourse {
  if (!isJson(v) || !isJson(v.centre)) return mismatch('course');
  const { id, title, category, county, area, durationWeeks, feeKes, nextStart, certificateLevel, centre } = v as Json & { centre: Json };
  if (
    !isText(id) || !isText(title) || !oneOf(CATEGORIES, category) || !isText(county) || !isText(area) ||
    !isWhole(durationWeeks) || !isWhole(feeKes) || !isTime(nextStart) || !oneOf(LEVELS, certificateLevel) ||
    !isText(centre.id) || !isText(centre.name)
  ) {
    return mismatch('course');
  }
  return { id, title, category, centre: { id: centre.id, name: centre.name }, county, area, durationWeeks, feeKes, nextStart, certificateLevel };
}

function parseBooking(v: unknown): UjuziBooking {
  if (!isJson(v)) return mismatch('booking');
  const { id, courseId, eventName, crewSize, preferredStart, status, createdAt } = v;
  if (!isText(id) || !isText(courseId) || !isText(eventName) || !isWhole(crewSize) || !isTime(preferredStart) || !oneOf(BOOKING_STATUSES, status) || !isTime(createdAt)) {
    return mismatch('booking');
  }
  return { id, courseId, eventName, crewSize, preferredStart, status, createdAt };
}

function parseCertificate(v: unknown): UjuziCertificate {
  if (!isJson(v)) return mismatch('certificate');
  const { certificateNo, valid, courseTitle, level, issuedOn, holder } = v;
  if (!isText(certificateNo) || typeof valid !== 'boolean' || !isText(courseTitle) || !oneOf(LEVELS, level) || typeof issuedOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(issuedOn) || !isText(holder)) {
    return mismatch('certificate');
  }
  return { certificateNo, valid, courseTitle, level, issuedOn, holder };
}

/** A status Ujuzi may send for this call, or else the answer is not usable. */
function expect(res: PartnerResponse, ...allowed: number[]): void {
  if (!allowed.includes(res.status)) {
    throw new PartnerUnavailableError(PARTNER, `Ujuzi answered with an unexpected status ${res.status}`);
  }
}

// ---- S1: courses -----------------------------------------------------------------------------

/** The courses, and when they were fetched if this is a saved copy because Ujuzi could not be reached. */
export interface CourseList {
  courses: UjuziCourse[];
  /** Set only for a saved copy: the time it was fetched (UTC, ending in Z, no milliseconds). Absent means fresh. */
  asOf?: string;
}

async function readCourses(filter: { category?: string; county?: string }, opts: UjuziOptions, serveStale: boolean): Promise<CourseList> {
  const res = await call('/api/courses', { query: { category: filter.category, county: filter.county }, cache: true, serveStale, ...opts });
  expect(res, 200);
  if (!Array.isArray(res.body)) return mismatch('course list');
  return { courses: res.body.map(parseCourse), ...(res.stale ? { asOf: res.stale.asOf } : {}) };
}

/** Courses, optionally for one category and county. Remembered for 5 minutes: courses change daily at most. */
export async function listCourses(filter: { category?: string; county?: string } = {}, opts: UjuziOptions = {}): Promise<UjuziCourse[]> {
  return (await readCourses(filter, opts, false)).courses;
}

/**
 * The same, for a caller that can show a saved copy honestly: when Ujuzi cannot be reached it answers with the
 * last good list (up to an hour old) and says when it was fetched, instead of failing. The caller must show that.
 */
export async function listCoursesWithFreshness(filter: { category?: string; county?: string } = {}, opts: UjuziOptions = {}): Promise<CourseList> {
  return readCourses(filter, opts, true);
}

// ---- S2: certificates ------------------------------------------------------------------------

/** One certificate, or null if Ujuzi has no such number. Never remembered: revocation must show at once. */
export async function getCertificate(certificateNo: string, opts: UjuziOptions = {}): Promise<UjuziCertificate | null> {
  const res = await call(`/api/certificates/${encodeURIComponent(certificateNo)}`, opts);
  expect(res, 200, 404);
  return res.status === 404 ? null : parseCertificate(res.body);
}

// ---- S3, S4, S5: bookings --------------------------------------------------------------------

export interface NewUjuziBooking {
  courseId: string;
  crewSize: number;
  preferredStart: Date;
  eventName: string;
}

/** Books group training. Throws PartnerRejectedError for 404 (no such course), 400 and 409. */
export async function createBooking(input: NewUjuziBooking, opts: UjuziOptions = {}): Promise<UjuziBooking> {
  const res = await call('/api/bookings', {
    method: 'POST',
    body: { courseId: input.courseId, crewSize: input.crewSize, preferredStart: input.preferredStart.toISOString().replace(/\.\d{3}Z$/, 'Z'), eventName: input.eventName },
    ...opts,
  });
  if ([400, 404, 409].includes(res.status)) throw new PartnerRejectedError(PARTNER, res.status);
  expect(res, 201);
  return parseBooking(res.body);
}

/** A booking's current state, or null if Ujuzi no longer has it. Never remembered. */
export async function getBooking(bookingId: string, opts: UjuziOptions = {}): Promise<UjuziBooking | null> {
  const res = await call(`/api/bookings/${encodeURIComponent(bookingId)}`, opts);
  expect(res, 200, 404);
  return res.status === 404 ? null : parseBooking(res.body);
}

/** Replaces crew size and start date of a pending booking. null if gone; PartnerRejectedError for 400 and 409. */
export async function updateBooking(
  bookingId: string,
  input: { crewSize: number; preferredStart: Date },
  opts: UjuziOptions = {},
): Promise<UjuziBooking | null> {
  const res = await call(`/api/bookings/${encodeURIComponent(bookingId)}`, {
    method: 'PUT',
    body: { crewSize: input.crewSize, preferredStart: input.preferredStart.toISOString().replace(/\.\d{3}Z$/, 'Z') },
    ...opts,
  });
  if ([400, 409].includes(res.status)) throw new PartnerRejectedError(PARTNER, res.status);
  expect(res, 200, 404);
  return res.status === 404 ? null : parseBooking(res.body);
}

/** Cancels a pending booking. 'not_found' if Ujuzi no longer has it; PartnerRejectedError(409) if it is decided. */
export async function cancelBooking(bookingId: string, opts: UjuziOptions = {}): Promise<'cancelled' | 'not_found'> {
  const res = await call(`/api/bookings/${encodeURIComponent(bookingId)}`, { method: 'DELETE', ...opts });
  if (res.status === 409) throw new PartnerRejectedError(PARTNER, 409);
  expect(res, 204, 404);
  return res.status === 204 ? 'cancelled' : 'not_found';
}
