import type { components } from '@/types/api';

// Enums come from the contract types, so a change to openapi.yaml that is not mirrored here (or in
// the SQL CHECK constraints) fails `npm run typecheck`.
type Schemas = components['schemas'];
export type EventType = Schemas['Event']['type'];
export type EventStatus = Schemas['Event']['status'];
export type RoleCategory = Schemas['Role']['category'];
export type OfferStatus = Schemas['Offer']['status'];

// Row types mirror the tables in migrations/: snake_case, timestamps as Date. lib/mappers.ts turns
// them into the camelCase contract shapes.
export interface UserRow {
  id: string; // usr_1001
  email: string; // stored and matched in lower case
  name: string;
  password_hash: string; // scrypt, never the password
  created_at: Date;
}

export interface SessionRow {
  token_hash: string; // SHA-256 of the bearer token, never the token
  user_id: string;
  created_at: Date;
  expires_at: Date;
}

export interface EventRow {
  id: string; // evt_2001
  organiser_id: string;
  name: string;
  type: EventType;
  county: string;
  area: string;
  venue: string;
  starts_at: Date;
  ends_at: Date;
  expected_guests: number;
  status: EventStatus;
  created_at: Date;
}

export interface RoleRow {
  id: string; // rol_3001
  event_id: string;
  title: string;
  category: RoleCategory;
  headcount: number;
  filled: number;
  shift_start: Date;
  shift_end: Date;
  pay_per_shift: number; // KES
  created_at: Date;
}

export interface OfferRow {
  id: string; // ofr_4001
  role_id: string;
  event_id: string;
  workers_offered: number;
  note: string; // '' when none was sent
  status: OfferStatus;
  created_at: Date;
}

// What a caller supplies; the store assigns id and created_at (and status 'pending' for offers).
export type NewUser = Pick<UserRow, 'email' | 'name' | 'password_hash'>;
export type NewSession = Pick<SessionRow, 'token_hash' | 'user_id' | 'expires_at'>;
export type NewEvent = Omit<EventRow, 'id' | 'created_at'>;
export type NewRole = Omit<RoleRow, 'id' | 'created_at'>;
export type NewOffer = Pick<OfferRow, 'role_id' | 'event_id' | 'workers_offered' | 'note'>;

export interface EventFilter {
  status?: EventStatus;
  county?: string; // matched ignoring case
}

/** Thrown when a write would break a uniqueness rule (for example a second account per email). */
export class StoreConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StoreConflictError';
  }
}

/**
 * Everything the handlers may ask of the database. The in-memory store and the PostgreSQL store
 * implement it with identical behaviour, so tests and a clean clone run without a database.
 * `get`/`find` methods answer null for a missing row; lists answer [] when nothing matches.
 */
export interface Store {
  users: {
    create(input: NewUser): Promise<UserRow>; // throws StoreConflictError when the email is taken
    findById(id: string): Promise<UserRow | null>;
    findByEmail(email: string): Promise<UserRow | null>;
  };
  sessions: {
    create(input: NewSession): Promise<SessionRow>;
    findByTokenHash(tokenHash: string): Promise<SessionRow | null>;
    delete(tokenHash: string): Promise<boolean>;
  };
  events: {
    list(filter?: EventFilter): Promise<EventRow[]>; // soonest first
    get(id: string): Promise<EventRow | null>;
    create(input: NewEvent): Promise<EventRow>;
  };
  roles: {
    listByEvent(eventId: string): Promise<RoleRow[]>;
    get(id: string): Promise<RoleRow | null>;
    create(input: NewRole): Promise<RoleRow>;
  };
  offers: {
    create(input: NewOffer): Promise<OfferRow>; // always pending
    get(id: string): Promise<OfferRow | null>;
    listByEvent(eventId: string): Promise<OfferRow[]>; // oldest first
    setStatus(id: string, status: OfferStatus): Promise<OfferRow | null>;
    delete(id: string): Promise<boolean>;
  };
  close(): Promise<void>;
}

/** Starting rows for a fresh database. Only the in-memory store and `db:seed` read this. */
export interface SeedData {
  users: UserRow[];
  events: EventRow[];
  roles: RoleRow[];
  offers: OfferRow[];
}
