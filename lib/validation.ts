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
