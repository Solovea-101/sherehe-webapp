// The exact field names openapi.yaml requires for each response shape. Tests compare whole key
// lists, so an extra field fails just as a missing one does.
export const EVENT_KEYS = [
  'area', 'county', 'endsAt', 'expectedGuests', 'id', 'name', 'startsAt', 'status', 'type', 'venue',
];
export const ROLE_KEYS = [
  'category', 'eventId', 'filled', 'headcount', 'id', 'payPerShift', 'shiftEnd', 'shiftStart', 'title',
];
export const OFFER_KEYS = ['createdAt', 'eventId', 'id', 'note', 'roleId', 'status', 'workersOffered'];

// ISO 8601 in UTC, a Z, no milliseconds.
export const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

export const keysOf = (value: object) => Object.keys(value).sort();
