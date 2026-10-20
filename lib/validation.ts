import type { EventFilter, EventStatus } from '@/lib/db/types';

export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

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

export type EventsQuery = EventFilter & { status: EventStatus };

/**
 * GET /api/events?status=upcoming&county=. status is required and only "upcoming" is allowed (the
 * contract's enum). county is optional: blank means "every county", anything else must be one of
 * the 47 counties (any letter case) and comes back in its official spelling. Unknown parameters
 * are ignored.
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

  const countyParam = single(params, 'county');
  if (!countyParam.ok) return countyParam;
  const typed = countyParam.value?.trim();
  if (typed === undefined || typed === '') return { ok: true, value: { status: 'upcoming' } };

  const county = findCounty(typed);
  if (!county) {
    return { ok: false, message: "county must be one of Kenya's 47 counties, for example Nairobi" };
  }
  return { ok: true, value: { status: 'upcoming', county } };
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
