import type { components } from '@/types/api';
import type { EventRow, OfferRow, RoleRow, UserRow } from '@/lib/db/types';

// Rows (snake_case, Date) to the contract shapes (camelCase, ISO strings). Every field is named
// explicitly, so a column added to a table never leaks into a response by accident, and a field
// added to openapi.yaml but missing here fails `npm run typecheck`.
type Schemas = components['schemas'];
export type ApiEvent = Schemas['Event'];
export type ApiRole = Schemas['Role'];
export type ApiOffer = Schemas['Offer'];
export type ApiUser = Schemas['User'];
export type ApiAuthResult = Schemas['AuthResult'];

/** ISO 8601 in UTC with a Z and no milliseconds, as every system in the ring writes dates. */
export function toIso(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function toEvent(row: EventRow): ApiEvent {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    county: row.county,
    area: row.area,
    venue: row.venue,
    startsAt: toIso(row.starts_at),
    endsAt: toIso(row.ends_at),
    expectedGuests: row.expected_guests,
    status: row.status,
  };
}

export function toRole(row: RoleRow): ApiRole {
  return {
    id: row.id,
    eventId: row.event_id,
    title: row.title,
    category: row.category,
    headcount: row.headcount,
    filled: row.filled,
    shiftStart: toIso(row.shift_start),
    shiftEnd: toIso(row.shift_end),
    payPerShift: row.pay_per_shift,
  };
}

export function toOffer(row: OfferRow): ApiOffer {
  return {
    id: row.id,
    roleId: row.role_id,
    eventId: row.event_id,
    workersOffered: row.workers_offered,
    note: row.note,
    status: row.status,
    createdAt: toIso(row.created_at),
  };
}

/** Only id, email and name leave the server. The password hash never does. */
export function toUser(row: UserRow): ApiUser {
  return { id: row.id, email: row.email, name: row.name };
}

export function toAuthResult(user: UserRow, token: string, expiresAt: Date): ApiAuthResult {
  return { token, expiresAt: toIso(expiresAt), user: toUser(user) };
}
