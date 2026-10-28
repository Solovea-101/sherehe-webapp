import type { EventFilter, EventStatus, EventType, RoleCategory } from '@/lib/db/types';

export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

// Value lists that mirror enums in openapi.yaml. The `Same` checks make `npm run typecheck` fail
// if a list and the contract ever disagree, in either direction.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

export const EVENT_TYPES = ['wedding', 'conference', 'concert', 'corporate', 'other'] as const;
export const CATEGORIES = [
  'accommodation', 'campus', 'catering', 'cleaning', 'electrical', 'events', 'plumbing', 'security', 'tutoring',
] as const;
export const _eventTypesMatchContract: Same<(typeof EVENT_TYPES)[number], EventType> = true;
export const _categoriesMatchContract: Same<(typeof CATEGORIES)[number], RoleCategory> = true;

/** Kenya's 47 counties, official names in title case. */
export const COUNTIES = [
  'Mombasa', 'Kwale', 'Kilifi', 'Tana River', 'Lamu', 'Taita-Taveta', 'Garissa', 'Wajir', 'Mandera',
  'Marsabit', 'Isiolo', 'Meru', 'Tharaka-Nithi', 'Embu', 'Kitui', 'Machakos', 'Makueni', 'Nyandarua',
  'Nyeri', 'Kirinyaga', "Murang'a", 'Kiambu', 'Turkana', 'West Pokot', 'Samburu', 'Trans-Nzoia',
  'Uasin Gishu', 'Elgeyo-Marakwet', 'Nandi', 'Baringo', 'Laikipia', 'Nakuru', 'Narok', 'Kajiado',
  'Kericho', 'Bomet', 'Kakamega', 'Vihiga', 'Bungoma', 'Busia', 'Siaya', 'Kisumu', 'Homa Bay',
  'Migori', 'Kisii', 'Nyamira', 'Nairobi',
] as const;

const COUNTY_BY_LOWER = new Map<string, string>(COUNTIES.map((c) => [c.toLowerCase(), c]));

/** The official spelling of a county given in any letter case, or undefined if it is not one. */
export function findCounty(input: string): string | undefined {
  return COUNTY_BY_LOWER.get(input.trim().toLowerCase());
}

/**
 * Reads one query parameter that may appear at most once. Returns undefined when it is absent;
 * a parameter given twice is ambiguous, so it is an error rather than "take the first".
 */
function single(params: URLSearchParams, name: string): Parsed<string | undefined> {
  const all = params.getAll(name);
  if (all.length > 1) return { ok: false, message: `${name} can be given only once` };
  return { ok: true, value: all[0] };
}

export type EventsQuery = EventFilter & { status: EventStatus; /** include=roles: each event carries its roles */ includeRoles?: true };

/**
 * GET /api/events?status=upcoming&county=. status is required and only "upcoming" is allowed (the
 * contract's enum). county is optional: blank means "every county", anything else must be one of
 * the 47 counties (any letter case) and comes back in its official spelling. include is optional and
 * can only be "roles" (each event then carries its staffing roles). Other parameters are ignored.
 */
export function parseEventsQuery(params: URLSearchParams): Parsed<EventsQuery> {
  const status = single(params, 'status');
  if (!status.ok) return status;
  if (status.value === undefined || status.value === '') {
    return { ok: false, message: 'status is required; use status=upcoming' };
  }
  if (status.value !== 'upcoming') {
    return { ok: false, message: 'status must be upcoming; only upcoming events can still be staffed' };
  }

  const includeParam = single(params, 'include');
  if (!includeParam.ok) return includeParam;
  const include = includeParam.value?.trim();
  if (include !== undefined && include !== '' && include !== 'roles') {
    return { ok: false, message: 'include can only be roles' };
  }
  const extra = include === 'roles' ? { includeRoles: true as const } : {};

  const countyParam = single(params, 'county');
  if (!countyParam.ok) return countyParam;
  const typed = countyParam.value?.trim();
  if (typed === undefined || typed === '') return { ok: true, value: { status: 'upcoming', ...extra } };

  const county = findCounty(typed);
  if (!county) {
    return { ok: false, message: "county must be one of Kenya's 47 counties, for example Nairobi" };
  }
  return { ok: true, value: { status: 'upcoming', county, ...extra } };
}

// ---- request bodies ----------------------------------------------------------------------------
//
// Every write validates before it touches anything: the body must be a JSON object, carry no field
// the contract does not list, and each field must be present, of the right type and a usable value.
// The first problem found becomes the 400 message, in the order the fields are declared.

export type Fields = { [field: string]: unknown };

/** The body must be a JSON object (not an array, a string, null...) with only the listed fields. */
export function readFields(body: unknown, allowed: readonly string[]): Parsed<Fields> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, message: 'The request body must be a JSON object' };
  }
  const fields = body as Fields;
  const unknown = Object.keys(fields).find((key) => !allowed.includes(key));
  if (unknown !== undefined) {
    const shown = unknown.length > 40 ? `${unknown.slice(0, 40)}...` : unknown;
    return { ok: false, message: `Unknown field "${shown}"; allowed fields are ${allowed.join(', ')}` };
  }
  return { ok: true, value: fields };
}

/** Required text, trimmed. min defaults to 1, so blank text is refused. */
export function text(fields: Fields, name: string, opts: { max: number; min?: number; trim?: boolean }): Parsed<string> {
  const raw = fields[name];
  if (raw === undefined || raw === null) return { ok: false, message: `${name} is required` };
  if (typeof raw !== 'string') return { ok: false, message: `${name} must be text` };
  const value = opts.trim === false ? raw : raw.trim();
  const min = opts.min ?? 1;
  if (value.length < min) {
    return { ok: false, message: min <= 1 ? `${name} cannot be empty` : `${name} must be at least ${min} characters` };
  }
  if (value.length > opts.max) return { ok: false, message: `${name} must be at most ${opts.max} characters` };
  return { ok: true, value };
}

/** Required whole number in a range. "6" and 6.5 are refused; only a JSON integer passes. */
export function whole(fields: Fields, name: string, opts: { min: number; max: number }): Parsed<number> {
  const raw = fields[name];
  if (raw === undefined || raw === null) return { ok: false, message: `${name} is required` };
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < opts.min || raw > opts.max) {
    return { ok: false, message: `${name} must be a whole number from ${opts.min} to ${opts.max}` };
  }
  return { ok: true, value: raw };
}

/** Required value from a fixed list. */
export function oneOf<T extends string>(fields: Fields, name: string, allowed: readonly T[]): Parsed<T> {
  const raw = fields[name];
  if (raw === undefined || raw === null) return { ok: false, message: `${name} is required` };
  const match = allowed.find((value) => value === raw);
  if (match === undefined) return { ok: false, message: `${name} must be one of ${allowed.join(', ')}` };
  return { ok: true, value: match };
}

const ISO_UTC = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/;
export const DATE_EXAMPLE = '2026-11-28T08:00:00Z';

/** Required ISO 8601 UTC date-time with a Z and no milliseconds, as every system in the ring writes. */
export function dateTime(fields: Fields, name: string): Parsed<Date> {
  const raw = fields[name];
  if (raw === undefined || raw === null) return { ok: false, message: `${name} is required` };
  const bad = { ok: false as const, message: `${name} must be an ISO 8601 UTC date-time such as ${DATE_EXAMPLE}` };
  if (typeof raw !== 'string' || !ISO_UTC.test(raw)) return bad;
  const date = new Date(raw);
  // 2026-02-31 parses on some engines by rolling over; writing it back exposes that.
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 19) !== raw.slice(0, 19)) return bad;
  return { ok: true, value: date };
}

/** Like dateTime, but the moment must still be ahead of `now`. */
export function futureDateTime(fields: Fields, name: string, now: Date): Parsed<Date> {
  const parsed = dateTime(fields, name);
  if (parsed.ok && parsed.value.getTime() <= now.getTime()) {
    return { ok: false, message: `${name} must be in the future, for example ${DATE_EXAMPLE}` };
  }
  return parsed;
}

// ---- accounts ----------------------------------------------------------------------------------

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function email(fields: Fields): Parsed<string> {
  const parsed = text(fields, 'email', { max: 254 });
  if (!parsed.ok) return parsed;
  const value = parsed.value.toLowerCase();
  return EMAIL.test(value) ? { ok: true, value } : { ok: false, message: 'email must be a valid email address' };
}

export interface NewAccountInput {
  email: string;
  name: string;
  password: string;
}

/** POST /api/auth/register. The email comes back trimmed and in lower case. */
export function parseNewAccount(body: unknown): Parsed<NewAccountInput> {
  const fields = readFields(body, ['email', 'name', 'password']);
  if (!fields.ok) return fields;
  const address = email(fields.value);
  if (!address.ok) return address;
  const name = text(fields.value, 'name', { max: 100 });
  if (!name.ok) return name;
  // Passwords are taken exactly as typed: spaces count, and nothing is trimmed.
  const password = text(fields.value, 'password', { min: 8, max: 128, trim: false });
  if (!password.ok) return password;
  return { ok: true, value: { email: address.value, name: name.value, password: password.value } };
}

export interface CredentialsInput {
  email: string;
  password: string;
}

/** POST /api/auth/login. Only presence is checked for the password, so the rules are not revealed. */
export function parseCredentials(body: unknown): Parsed<CredentialsInput> {
  const fields = readFields(body, ['email', 'password']);
  if (!fields.ok) return fields;
  const address = email(fields.value);
  if (!address.ok) return address;
  const password = text(fields.value, 'password', { max: 128, trim: false });
  if (!password.ok) return password;
  return { ok: true, value: { email: address.value, password: password.value } };
}

// ---- events and roles --------------------------------------------------------------------------

/** A required county, in any letter case, returned in its official spelling. */
function county(fields: Fields): Parsed<string> {
  const typed = text(fields, 'county', { max: 50 });
  if (!typed.ok) return typed;
  const official = findCounty(typed.value);
  return official
    ? { ok: true, value: official }
    : { ok: false, message: "county must be one of Kenya's 47 counties, for example Nairobi" };
}

export interface NewEventInput {
  name: string;
  type: EventType;
  county: string;
  area: string;
  venue: string;
  startsAt: Date;
  endsAt: Date;
  expectedGuests: number;
}

/** POST /api/events. The organiser and the status (upcoming) are never taken from the body. */
export function parseNewEvent(body: unknown, now: Date = new Date()): Parsed<NewEventInput> {
  const fields = readFields(body, ['name', 'type', 'county', 'area', 'venue', 'startsAt', 'endsAt', 'expectedGuests']);
  if (!fields.ok) return fields;
  const f = fields.value;
  const name = text(f, 'name', { max: 120 });
  if (!name.ok) return name;
  const type = oneOf(f, 'type', EVENT_TYPES);
  if (!type.ok) return type;
  const countyName = county(f);
  if (!countyName.ok) return countyName;
  const area = text(f, 'area', { max: 80 });
  if (!area.ok) return area;
  const venue = text(f, 'venue', { max: 120 });
  if (!venue.ok) return venue;
  const startsAt = futureDateTime(f, 'startsAt', now);
  if (!startsAt.ok) return startsAt;
  const endsAt = dateTime(f, 'endsAt');
  if (!endsAt.ok) return endsAt;
  if (endsAt.value.getTime() <= startsAt.value.getTime()) {
    return { ok: false, message: 'endsAt must be after startsAt' };
  }
  const expectedGuests = whole(f, 'expectedGuests', { min: 1, max: 100_000 });
  if (!expectedGuests.ok) return expectedGuests;
  return {
    ok: true,
    value: {
      name: name.value, type: type.value, county: countyName.value, area: area.value, venue: venue.value,
      startsAt: startsAt.value, endsAt: endsAt.value, expectedGuests: expectedGuests.value,
    },
  };
}

export interface NewRoleInput {
  title: string;
  category: RoleCategory;
  headcount: number;
  shiftStart: Date;
  shiftEnd: Date;
  payPerShift: number;
}

/** POST /api/events/{eventId}/roles. `filled` always starts at 0 and is never taken from the body. */
export function parseNewRole(body: unknown, now: Date = new Date()): Parsed<NewRoleInput> {
  const fields = readFields(body, ['title', 'category', 'headcount', 'shiftStart', 'shiftEnd', 'payPerShift']);
  if (!fields.ok) return fields;
  const f = fields.value;
  const title = text(f, 'title', { max: 80 });
  if (!title.ok) return title;
  const category = oneOf(f, 'category', CATEGORIES);
  if (!category.ok) return category;
  const headcount = whole(f, 'headcount', { min: 1, max: 1000 });
  if (!headcount.ok) return headcount;
  const shiftStart = futureDateTime(f, 'shiftStart', now);
  if (!shiftStart.ok) return shiftStart;
  const shiftEnd = dateTime(f, 'shiftEnd');
  if (!shiftEnd.ok) return shiftEnd;
  if (shiftEnd.value.getTime() <= shiftStart.value.getTime()) {
    return { ok: false, message: 'shiftEnd must be after shiftStart' };
  }
  const payPerShift = whole(f, 'payPerShift', { min: 0, max: 100_000 });
  if (!payPerShift.ok) return payPerShift;
  return {
    ok: true,
    value: {
      title: title.value, category: category.value, headcount: headcount.value,
      shiftStart: shiftStart.value, shiftEnd: shiftEnd.value, payPerShift: payPerShift.value,
    },
  };
}

// ---- offers ------------------------------------------------------------------------------------

export interface NewOfferInput {
  roleId: string;
  workersOffered: number;
  note: string;
}

/**
 * POST /api/offers. The number of workers is checked here for shape (a whole number, at least 1);
 * whether the role has that many open places is checked by the handler, which can see the role.
 */
export function parseNewOffer(body: unknown): Parsed<NewOfferInput> {
  const fields = readFields(body, ['roleId', 'workersOffered', 'note']);
  if (!fields.ok) return fields;
  const f = fields.value;
  const roleId = text(f, 'roleId', { max: 40 });
  if (!roleId.ok) return roleId;

  const workers = f.workersOffered;
  if (typeof workers !== 'number' || !Number.isInteger(workers) || workers < 1) {
    return { ok: false, message: 'workersOffered must be a whole number from 1 to the open slots' };
  }

  // note is optional; sending none is the same as sending "". null and non-text are mistakes.
  let note = '';
  if (f.note !== undefined) {
    const parsed = text(f, 'note', { max: 500, min: 0 });
    if (!parsed.ok) return parsed;
    note = parsed.value;
  }
  return { ok: true, value: { roleId: roleId.value, workersOffered: workers, note } };
}

export type OfferDecisionInput = { status: 'accepted' | 'declined' };

/** PATCH /api/offers/{offerId}: the organiser accepts or declines. */
export function parseOfferDecision(body: unknown): Parsed<OfferDecisionInput> {
  const fields = readFields(body, ['status']);
  if (!fields.ok) return fields;
  const status = oneOf(fields.value, 'status', ['accepted', 'declined'] as const);
  return status.ok ? { ok: true, value: { status: status.value } } : status;
}

// ---- training and certificates -----------------------------------------------------------------

export interface TrainingQuery {
  category?: RoleCategory;
  county?: string;
}

/** GET /api/training-options?category=&county=. Both are optional; blank means "any". */
export function parseTrainingQuery(params: URLSearchParams): Parsed<TrainingQuery> {
  const category = single(params, 'category');
  if (!category.ok) return category;
  const countyParam = single(params, 'county');
  if (!countyParam.ok) return countyParam;

  const query: TrainingQuery = {};
  const typedCategory = category.value?.trim();
  if (typedCategory) {
    const match = CATEGORIES.find((c) => c === typedCategory);
    if (!match) return { ok: false, message: `category must be one of ${CATEGORIES.join(', ')}` };
    query.category = match;
  }
  const typedCounty = countyParam.value?.trim();
  if (typedCounty) {
    const official = findCounty(typedCounty);
    if (!official) return { ok: false, message: "county must be one of Kenya's 47 counties, for example Nairobi" };
    query.county = official;
  }
  return { ok: true, value: query };
}

// Ujuzi takes crews of 1 to 40 (its contract), so we refuse anything else before calling it.
const CREW_SIZE = { min: 1, max: 40 };

export interface NewCrewTrainingInput {
  eventId: string;
  courseId: string;
  crewSize: number;
  preferredStart: Date;
}

/** POST /api/crew-trainings. Whether the event is the organiser's, and still upcoming, is the handler's job. */
export function parseNewCrewTraining(body: unknown, now: Date = new Date()): Parsed<NewCrewTrainingInput> {
  const fields = readFields(body, ['eventId', 'courseId', 'crewSize', 'preferredStart']);
  if (!fields.ok) return fields;
  const f = fields.value;
  const eventId = text(f, 'eventId', { max: 40 });
  if (!eventId.ok) return eventId;
  const courseId = text(f, 'courseId', { max: 40 });
  if (!courseId.ok) return courseId;
  const crewSize = whole(f, 'crewSize', CREW_SIZE);
  if (!crewSize.ok) return crewSize;
  const preferredStart = futureDateTime(f, 'preferredStart', now);
  if (!preferredStart.ok) return preferredStart;
  return { ok: true, value: { eventId: eventId.value, courseId: courseId.value, crewSize: crewSize.value, preferredStart: preferredStart.value } };
}

export interface CrewTrainingUpdateInput {
  crewSize: number;
  preferredStart: Date;
}

/** PUT /api/crew-trainings/{trainingId}: both fields every time, because PUT replaces. */
export function parseCrewTrainingUpdate(body: unknown, now: Date = new Date()): Parsed<CrewTrainingUpdateInput> {
  const fields = readFields(body, ['crewSize', 'preferredStart']);
  if (!fields.ok) return fields;
  const crewSize = whole(fields.value, 'crewSize', CREW_SIZE);
  if (!crewSize.ok) return crewSize;
  const preferredStart = futureDateTime(fields.value, 'preferredStart', now);
  if (!preferredStart.ok) return preferredStart;
  return { ok: true, value: { crewSize: crewSize.value, preferredStart: preferredStart.value } };
}

const CERTIFICATE_NO = /^UJZ-\d{4}-\d{5}$/;

export interface NewCertificateCheckInput {
  certificateNo: string;
}

/** POST /api/certificate-checks. Any letter case is accepted; Ujuzi's numbers are upper case. */
export function parseNewCertificateCheck(body: unknown): Parsed<NewCertificateCheckInput> {
  const fields = readFields(body, ['certificateNo']);
  if (!fields.ok) return fields;
  const number = text(fields.value, 'certificateNo', { max: 40 });
  if (!number.ok) return number;
  const certificateNo = number.value.toUpperCase();
  if (!CERTIFICATE_NO.test(certificateNo)) {
    return { ok: false, message: 'certificateNo must look like UJZ-2026-00123' };
  }
  return { ok: true, value: { certificateNo } };
}
