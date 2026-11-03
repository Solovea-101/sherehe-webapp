/**
 * "Your events" without asking the API. The API cannot list an organiser's own events, so this browser
 * remembers the events the organiser created or opened as the owner, per account, and the home page
 * marks them. It is a convenience on this device only: another phone starts empty, and nothing here is
 * trusted for anything but a label. (A later API addition would replace it.)
 */
export interface RememberedEvent {
  id: string;
  name: string;
  startsAt: string;
  venue: string;
  county: string;
  type: string;
}

const MAX_REMEMBERED = 20;
const keyFor = (userId: string) => `sherehe_my_events_${userId}`;

function store(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null; // storage can be blocked; the site works without it
  }
}

const isRemembered = (v: unknown): v is RememberedEvent =>
  typeof v === 'object' && v !== null &&
  ['id', 'name', 'startsAt', 'venue', 'county', 'type'].every((k) => typeof (v as { [k: string]: unknown })[k] === 'string');

/** Most recently created or opened first. */
export function readMyEvents(userId: string): RememberedEvent[] {
  try {
    const raw = store()?.getItem(keyFor(userId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(isRemembered) : [];
  } catch {
    return [];
  }
}

export function rememberMyEvent(userId: string, event: RememberedEvent): void {
  try {
    const kept = readMyEvents(userId).filter((e) => e.id !== event.id);
    const entry: RememberedEvent = {
      id: event.id, name: event.name, startsAt: event.startsAt, venue: event.venue, county: event.county, type: event.type,
    };
    store()?.setItem(keyFor(userId), JSON.stringify([entry, ...kept].slice(0, MAX_REMEMBERED)));
  } catch {
    /* a full or blocked store only means the label is not remembered */
  }
}
