import { Pool, type PoolClient } from 'pg';
import {
  StoreConflictError,
  type CertificateCheckRow,
  type CrewTrainingRow,
  type DecideResult,
  type EventRow,
  type OfferRow,
  type RoleRow,
  type SessionRow,
  type Store,
  type UserRow,
  type WithdrawResult,
} from './types';

// PostgreSQL error codes this file turns into the Store's own errors.
const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';
const code = (err: unknown): string | undefined =>
  typeof err === 'object' && err !== null && 'code' in err ? String((err as { code: unknown }).code) : undefined;

/** Runs a query that may break a uniqueness rule or a reference, and reports those as the Store does. */
async function guarded<T>(work: Promise<T>, onUnique: string, onReference?: string): Promise<T> {
  try {
    return await work;
  } catch (err) {
    if (code(err) === UNIQUE_VIOLATION) throw new StoreConflictError(onUnique);
    // The memory store throws a plain Error for a missing reference; handlers check first, so this is a bug.
    if (code(err) === FOREIGN_KEY_VIOLATION) throw new Error(onReference ?? 'A referenced row does not exist');
    throw err;
  }
}

// issued_on is a calendar date; hand it back as 'YYYY-MM-DD' text rather than a Date in some timezone.
const CHECK_COLUMNS = `id, organiser_id, certificate_no, valid, course_title, level,
  to_char(issued_on, 'YYYY-MM-DD') AS issued_on, holder, checked_at`;
// Ids are prefix_number; sort by the number so trn_10000 follows trn_9999.
const idNumber = (column = 'id') => `split_part(${column}, '_', 2)::int`;

/** Runs several statements as one unit, rolling back if anything throws. */
async function transaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** The Store on PostgreSQL. Parameterised SQL only; behaviour matches the in-memory store. */
export function createPgStore(pool: Pool): Store {
  const one = async <T extends object>(sql: string, params: unknown[]): Promise<T | null> =>
    (await pool.query<T>(sql, params)).rows[0] ?? null;
  const many = async <T extends object>(sql: string, params: unknown[] = []): Promise<T[]> =>
    (await pool.query<T>(sql, params)).rows;

  return {
    users: {
      async create(input) {
        const email = input.email.toLowerCase();
        const row = await guarded(
          one<UserRow>('INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING *', [email, input.name, input.password_hash]),
          `An account with ${email} already exists`,
        );
        return row as UserRow;
      },
      findById: (id) => one<UserRow>('SELECT * FROM users WHERE id = $1', [id]),
      findByEmail: (email) => one<UserRow>('SELECT * FROM users WHERE lower(email) = lower($1)', [email]),
    },

    sessions: {
      async create(input) {
        const row = await guarded(
          one<SessionRow>('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3) RETURNING *', [input.token_hash, input.user_id, input.expires_at]),
          'A session with that token already exists',
          `User ${input.user_id} does not exist`,
        );
        return row as SessionRow;
      },
      findByTokenHash: (tokenHash) => one<SessionRow>('SELECT * FROM sessions WHERE token_hash = $1', [tokenHash]),
      async delete(tokenHash) {
        return ((await pool.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash])).rowCount ?? 0) > 0;
      },
    },

    events: {
      list: (filter = {}) =>
        many<EventRow>(
          `SELECT * FROM events
            WHERE ($1::text IS NULL OR status = $1)
              AND ($2::text IS NULL OR lower(county) = lower($2))
            ORDER BY starts_at, id`,
          [filter.status ?? null, filter.county ?? null],
        ),
      get: (id) => one<EventRow>('SELECT * FROM events WHERE id = $1', [id]),
      async create(input) {
        const row = await guarded(
          one<EventRow>(
            `INSERT INTO events (organiser_id, name, type, county, area, venue, starts_at, ends_at, expected_guests, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
            [input.organiser_id, input.name, input.type, input.county, input.area, input.venue, input.starts_at, input.ends_at, input.expected_guests, input.status],
          ),
          'That event already exists',
          `User ${input.organiser_id} does not exist`,
        );
        return row as EventRow;
      },
    },

    roles: {
      listByEvent: (eventId) => many<RoleRow>(`SELECT * FROM roles WHERE event_id = $1 ORDER BY ${idNumber()}`, [eventId]),
      get: (id) => one<RoleRow>('SELECT * FROM roles WHERE id = $1', [id]),
      async create(input) {
        const row = await guarded(
          one<RoleRow>(
            `INSERT INTO roles (event_id, title, category, headcount, filled, shift_start, shift_end, pay_per_shift)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
            [input.event_id, input.title, input.category, input.headcount, input.filled, input.shift_start, input.shift_end, input.pay_per_shift],
          ),
          'That role already exists',
          `Event ${input.event_id} does not exist`,
        );
        return row as RoleRow;
      },
    },

    offers: {
      async create(input) {
        const row = await guarded(
          one<OfferRow>(
            `INSERT INTO offers (role_id, event_id, workers_offered, note) VALUES ($1, $2, $3, $4) RETURNING *`,
            [input.role_id, input.event_id, input.workers_offered, input.note],
          ),
          `Role ${input.role_id} already has a pending offer`,
          `Role ${input.role_id} or event ${input.event_id} does not exist`,
        );
        return row as OfferRow;
      },
      get: (id) => one<OfferRow>('SELECT * FROM offers WHERE id = $1', [id]),
      listByEvent: (eventId) => many<OfferRow>(`SELECT * FROM offers WHERE event_id = $1 ORDER BY created_at, ${idNumber()}`, [eventId]),
      findPendingByRole: (roleId) => one<OfferRow>("SELECT * FROM offers WHERE role_id = $1 AND status = 'pending'", [roleId]),
      setStatus: (id, status) => one<OfferRow>('UPDATE offers SET status = $2 WHERE id = $1 RETURNING *', [id, status]),
      async delete(id) {
        return ((await pool.query('DELETE FROM offers WHERE id = $1', [id])).rowCount ?? 0) > 0;
      },

      // Locks the offer, then its role (always in that order), so two decisions arriving together
      // take turns: the second sees the first's result.
      decide: (id, status): Promise<DecideResult> =>
        transaction(pool, async (client): Promise<DecideResult> => {
          const offer = (await client.query<OfferRow>('SELECT * FROM offers WHERE id = $1 FOR UPDATE', [id])).rows[0];
          if (!offer) return { kind: 'not_found' };
          if (offer.status !== 'pending') return { kind: 'not_pending', offer };
          if (status === 'accepted') {
            const role = (await client.query<RoleRow>('SELECT * FROM roles WHERE id = $1 FOR UPDATE', [offer.role_id])).rows[0];
            if (!role) throw new Error(`Role ${offer.role_id} does not exist`);
            const openPlaces = role.headcount - role.filled;
            if (offer.workers_offered > openPlaces) return { kind: 'no_room', openPlaces };
            await client.query('UPDATE roles SET filled = filled + $2 WHERE id = $1', [role.id, offer.workers_offered]);
          }
          const updated = (await client.query<OfferRow>('UPDATE offers SET status = $2 WHERE id = $1 RETURNING *', [id, status])).rows[0];
          return { kind: 'ok', offer: updated };
        }),

      // One DELETE that only matches a pending offer, so it cannot race a decision.
      async withdraw(id): Promise<WithdrawResult> {
        const deleted = await pool.query("DELETE FROM offers WHERE id = $1 AND status = 'pending'", [id]);
        if ((deleted.rowCount ?? 0) > 0) return { kind: 'ok' };
        const offer = await one<OfferRow>('SELECT * FROM offers WHERE id = $1', [id]);
        return offer ? { kind: 'not_pending', offer } : { kind: 'not_found' };
      },
    },

    crewTrainings: {
      async create(input) {
        const row = await guarded(
          one<CrewTrainingRow>(
            `INSERT INTO crew_trainings (organiser_id, event_id, course_id, ujuzi_booking_id, crew_size, preferred_start, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
            [input.organiser_id, input.event_id, input.course_id, input.ujuzi_booking_id, input.crew_size, input.preferred_start, input.status],
          ),
          `Booking ${input.ujuzi_booking_id} is already recorded`,
          `User ${input.organiser_id} or event ${input.event_id} does not exist`,
        );
        return row as CrewTrainingRow;
      },
      get: (id) => one<CrewTrainingRow>('SELECT * FROM crew_trainings WHERE id = $1', [id]),
      listByOrganiser: (organiserId) =>
        many<CrewTrainingRow>(`SELECT * FROM crew_trainings WHERE organiser_id = $1 ORDER BY created_at DESC, ${idNumber()} DESC`, [organiserId]),
      listPending: () => many<CrewTrainingRow>(`SELECT * FROM crew_trainings WHERE status = 'pending' ORDER BY ${idNumber()}`),
      update: (id, changes) =>
        // COALESCE keeps a column unchanged when the change leaves it out (undefined becomes null here).
        one<CrewTrainingRow>(
          `UPDATE crew_trainings
              SET crew_size = COALESCE($2, crew_size), preferred_start = COALESCE($3, preferred_start),
                  status = COALESCE($4, status), updated_at = now()
            WHERE id = $1 RETURNING *`,
          [id, changes.crew_size ?? null, changes.preferred_start ?? null, changes.status ?? null],
        ),
      async delete(id) {
        return ((await pool.query('DELETE FROM crew_trainings WHERE id = $1', [id])).rowCount ?? 0) > 0;
      },
    },

    certificateChecks: {
      async create(input) {
        const row = await guarded(
          one<CertificateCheckRow>(
            `INSERT INTO certificate_checks (organiser_id, certificate_no, valid, course_title, level, issued_on, holder)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${CHECK_COLUMNS}`,
            [input.organiser_id, input.certificate_no, input.valid, input.course_title, input.level, input.issued_on, input.holder],
          ),
          'That check already exists',
          `User ${input.organiser_id} does not exist`,
        );
        return row as CertificateCheckRow;
      },
      listByOrganiser: (organiserId) =>
        many<CertificateCheckRow>(
          `SELECT ${CHECK_COLUMNS} FROM certificate_checks WHERE organiser_id = $1 ORDER BY checked_at DESC, ${idNumber()} DESC`,
          [organiserId],
        ),
    },

    async close() {
      await pool.end();
    },
  };
}
