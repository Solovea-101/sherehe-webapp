// Organisers are in Kenya, which keeps East Africa Time (UTC+3) all year with no daylight saving.
// Times typed into the website are read as Nairobi time and sent to the API as UTC with a Z, and
// times from the API are shown as Nairobi time, whatever timezone the browser itself is set to.

const EAT_OFFSET_HOURS = 3;

/**
 * "2026-12-05T17:00" (what a datetime-local field gives) as Nairobi time, to "2026-12-05T14:00:00Z".
 * Returns null for anything that is not a real date and time.
 */
export function eatInputToUtcIso(value: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const [year, month, day, hour, minute] = m.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, hour - EAT_OFFSET_HOURS, minute));
  // Date.UTC quietly rolls impossible values over (month 13 becomes January, 31 February becomes
  // March). Building the same wall-clock time and reading every part back catches that.
  const local = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const same =
    local.getUTCFullYear() === year && local.getUTCMonth() === month - 1 && local.getUTCDate() === day &&
    local.getUTCHours() === hour && local.getUTCMinutes() === minute;
  if (Number.isNaN(date.getTime()) || !same) return null;
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** "2026-12-05T14:00:00Z" to "Sat 5 Dec 2026, 17:00 EAT". */
export function formatEat(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const day = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Nairobi', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(date);
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Nairobi', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
  return `${day.replace(',', '')}, ${time} EAT`;
}

/** A UTC instant as the "YYYY-MM-DDTHH:mm" a datetime-local field wants, in Nairobi time. */
export function utcIsoToEatInput(iso: string): string {
  const date = new Date(new Date(iso).getTime() + EAT_OFFSET_HOURS * 3_600_000);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 16);
}

/** The earliest moment worth offering in a datetime-local field: now, in Nairobi time. */
export function nowAsEatInput(now: Date = new Date()): string {
  return utcIsoToEatInput(now.toISOString());
}
