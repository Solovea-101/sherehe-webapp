import { seedData } from './seedData';
import {
  StoreConflictError,
  type CertificateCheckRow,
  type CrewTrainingRow,
  type EventRow,
  type OfferRow,
  type RoleRow,
  type SeedData,
  type SessionRow,
  type Store,
  type UserRow,
} from './types';

// First number handed out per id prefix. Keep in step with the sequences in migrations/001_init.sql.
const ID_START = { usr: 1001, evt: 2001, rol: 3001, ofr: 4001, trn: 5001, chk: 7001 } as const;
type IdPrefix = keyof typeof ID_START;

// Continues numbering after the highest seeded id, as the SQL sequences do once seed rows are loaded.
function idGenerator(prefix: IdPrefix, existing: Iterable<{ id: string }>): () => string {
  let next: number = ID_START[prefix];
  for (const { id } of existing) {
    const n = Number(id.slice(prefix.length + 1));
    if (Number.isInteger(n) && n >= next) next = n + 1;
  }
  return () => `${prefix}_${next++}`;
}

// Callers get copies, so changing a returned row never changes what the store holds.
const copy = <T extends object>(row: T): T => ({ ...row });
const byStartThenId = (a: EventRow, b: EventRow) =>
  a.starts_at.getTime() - b.starts_at.getTime() || a.id.localeCompare(b.id);
const idNumber = (id: string) => Number(id.slice(id.indexOf('_') + 1));

/**
 * The store used when DATABASE_URL is unset. Behaves like the PostgreSQL store for everything the
 * handlers can reach: unique emails, references that must exist, ordering, case-insensitive
 * county matching. The SQL CHECK constraints are not mirrored; lib/validation.ts is the guard.
 * Pass a different seed (for example an empty one) to start from other data.
 */
export function createMemoryStore(seed: SeedData = seedData): Store {
  const users = new Map<string, UserRow>(seed.users.map((r) => [r.id, copy(r)]));
  const sessions = new Map<string, SessionRow>();
  const events = new Map<string, EventRow>(seed.events.map((r) => [r.id, copy(r)]));
  const roles = new Map<string, RoleRow>(seed.roles.map((r) => [r.id, copy(r)]));
  const offers = new Map<string, OfferRow>(seed.offers.map((r) => [r.id, copy(r)]));
  const trainings = new Map<string, CrewTrainingRow>((seed.crewTrainings ?? []).map((r) => [r.id, copy(r)]));
  const checks = new Map<string, CertificateCheckRow>((seed.certificateChecks ?? []).map((r) => [r.id, copy(r)]));

  const nextUserId = idGenerator('usr', users.values());
  const nextEventId = idGenerator('evt', events.values());
  const nextRoleId = idGenerator('rol', roles.values());
  const nextOfferId = idGenerator('ofr', offers.values());
  const nextTrainingId = idGenerator('trn', trainings.values());
  const nextCheckId = idGenerator('chk', checks.values());

  const mustExist = (map: Map<string, unknown>, id: string, what: string) => {
    if (!map.has(id)) throw new Error(`${what} ${id} does not exist`); // a foreign key violation
  };

  return {
    users: {
      async create(input) {
        const email = input.email.toLowerCase();
        if ([...users.values()].some((u) => u.email === email)) {
          throw new StoreConflictError(`An account with ${email} already exists`);
        }
        const row: UserRow = { ...input, email, id: nextUserId(), created_at: new Date() };
        users.set(row.id, row);
        return copy(row);
      },
      async findById(id) {
        const row = users.get(id);
        return row ? copy(row) : null;
      },
      async findByEmail(email) {
        const wanted = email.toLowerCase();
        const row = [...users.values()].find((u) => u.email === wanted);
        return row ? copy(row) : null;
      },
    },

    sessions: {
      async create(input) {
        if (sessions.has(input.token_hash)) {
          throw new StoreConflictError('A session with that token already exists');
        }
        const row: SessionRow = { ...input, created_at: new Date() };
        sessions.set(row.token_hash, row);
        return copy(row);
      },
      async findByTokenHash(tokenHash) {
        const row = sessions.get(tokenHash);
        return row ? copy(row) : null;
      },
      async delete(tokenHash) {
        return sessions.delete(tokenHash);
      },
    },

    events: {
      async list(filter = {}) {
        const county = filter.county?.toLowerCase();
        return [...events.values()]
          .filter((e) => (filter.status === undefined || e.status === filter.status))
          .filter((e) => county === undefined || e.county.toLowerCase() === county)
          .sort(byStartThenId)
          .map(copy);
      },
      async get(id) {
        const row = events.get(id);
        return row ? copy(row) : null;
      },
      async create(input) {
        mustExist(users, input.organiser_id, 'User');
        const row: EventRow = { ...input, id: nextEventId(), created_at: new Date() };
        events.set(row.id, row);
        return copy(row);
      },
    },

    roles: {
      async listByEvent(eventId) {
        return [...roles.values()]
          .filter((r) => r.event_id === eventId)
          .sort((a, b) => a.id.localeCompare(b.id))
          .map(copy);
      },
      async get(id) {
        const row = roles.get(id);
        return row ? copy(row) : null;
      },
      async create(input) {
        mustExist(events, input.event_id, 'Event');
        const row: RoleRow = { ...input, id: nextRoleId(), created_at: new Date() };
        roles.set(row.id, row);
        return copy(row);
      },
    },

    offers: {
      async create(input) {
        mustExist(roles, input.role_id, 'Role');
        mustExist(events, input.event_id, 'Event');
        // At most one pending offer per role (a partial unique index in PostgreSQL).
        if ([...offers.values()].some((o) => o.role_id === input.role_id && o.status === 'pending')) {
          throw new StoreConflictError(`Role ${input.role_id} already has a pending offer`);
        }
        const row: OfferRow = { ...input, id: nextOfferId(), status: 'pending', created_at: new Date() };
        offers.set(row.id, row);
        return copy(row);
      },
      async get(id) {
        const row = offers.get(id);
        return row ? copy(row) : null;
      },
      async listByEvent(eventId) {
        return [...offers.values()]
          .filter((o) => o.event_id === eventId)
          .sort((a, b) => a.created_at.getTime() - b.created_at.getTime() || a.id.localeCompare(b.id))
          .map(copy);
      },
      async findPendingByRole(roleId) {
        const row = [...offers.values()].find((o) => o.role_id === roleId && o.status === 'pending');
        return row ? copy(row) : null;
      },
      async setStatus(id, status) {
        const row = offers.get(id);
        if (!row) return null;
        row.status = status;
        return copy(row);
      },
      async delete(id) {
        return offers.delete(id);
      },
      async decide(id, status) {
        const offer = offers.get(id);
        if (!offer) return { kind: 'not_found' };
        if (offer.status !== 'pending') return { kind: 'not_pending', offer: copy(offer) };
        if (status === 'accepted') {
          const role = roles.get(offer.role_id);
          if (!role) throw new Error(`Role ${offer.role_id} does not exist`); // a foreign key violation
          const openPlaces = role.headcount - role.filled;
          if (offer.workers_offered > openPlaces) return { kind: 'no_room', openPlaces };
          role.filled += offer.workers_offered;
        }
        offer.status = status;
        return { kind: 'ok', offer: copy(offer) };
      },
      async withdraw(id) {
        const offer = offers.get(id);
        if (!offer) return { kind: 'not_found' };
        if (offer.status !== 'pending') return { kind: 'not_pending', offer: copy(offer) };
        offers.delete(id);
        return { kind: 'ok' };
      },
    },

    crewTrainings: {
      async create(input) {
        mustExist(users, input.organiser_id, 'User');
        mustExist(events, input.event_id, 'Event');
        if ([...trainings.values()].some((t) => t.ujuzi_booking_id === input.ujuzi_booking_id)) {
          throw new StoreConflictError(`Booking ${input.ujuzi_booking_id} is already recorded`);
        }
        const now = new Date();
        const row: CrewTrainingRow = { ...input, id: nextTrainingId(), created_at: now, updated_at: now };
        trainings.set(row.id, row);
        return copy(row);
      },
      async get(id) {
        const row = trainings.get(id);
        return row ? copy(row) : null;
      },
      async listByOrganiser(organiserId) {
        return [...trainings.values()]
          .filter((t) => t.organiser_id === organiserId)
          .sort((a, b) => b.created_at.getTime() - a.created_at.getTime() || idNumber(b.id) - idNumber(a.id))
          .map(copy);
      },
      async listPending() {
        return [...trainings.values()]
          .filter((t) => t.status === 'pending')
          .sort((a, b) => idNumber(a.id) - idNumber(b.id))
          .map(copy);
      },
      async update(id, changes) {
        const row = trainings.get(id);
        if (!row) return null;
        Object.assign(row, changes, { updated_at: new Date() });
        return copy(row);
      },
      async delete(id) {
        return trainings.delete(id);
      },
    },

    certificateChecks: {
      async create(input) {
        mustExist(users, input.organiser_id, 'User');
        const row: CertificateCheckRow = { ...input, id: nextCheckId(), checked_at: new Date() };
        checks.set(row.id, row);
        return copy(row);
      },
      async listByOrganiser(organiserId) {
        return [...checks.values()]
          .filter((c) => c.organiser_id === organiserId)
          .sort((a, b) => b.checked_at.getTime() - a.checked_at.getTime() || idNumber(b.id) - idNumber(a.id))
          .map(copy);
      },
    },

    async close() {
      // Nothing to release.
    },
  };
}
