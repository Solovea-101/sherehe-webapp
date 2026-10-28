import path from 'node:path';
import { loadEnvConfig } from '@next/env';
import { Pool, type PoolClient } from 'pg';
import { migrate } from './migrate';
import { seedData } from './seedData';
import type { SeedData } from './types';

// The sequence behind each id prefix (see migrations/). After rows with explicit ids are loaded,
// each sequence is moved past the highest one so new rows do not collide.
const SEQUENCES: Array<[table: string, sequence: string]> = [
  ['users', 'user_id_seq'],
  ['events', 'event_id_seq'],
  ['roles', 'role_id_seq'],
  ['offers', 'offer_id_seq'],
  ['crew_trainings', 'training_id_seq'],
  ['certificate_checks', 'check_id_seq'],
];

async function advanceSequences(client: PoolClient): Promise<void> {
  for (const [table, sequence] of SEQUENCES) {
    // table and sequence names come from the list above, never from input
    const { rows } = await client.query<{ top: number | null }>(`SELECT max(split_part(id, '_', 2)::int) AS top FROM ${table}`);
    const top = rows[0].top;
    if (top !== null) await client.query('SELECT setval($1, $2)', [sequence, top]);
  }
}

/** Loads starting rows with their explicit ids, in one transaction. The tables should be empty. */
export async function seedPostgres(pool: Pool, seed: SeedData = seedData): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const u of seed.users) {
      await client.query('INSERT INTO users (id, email, name, password_hash, created_at) VALUES ($1, $2, $3, $4, $5)', [u.id, u.email, u.name, u.password_hash, u.created_at]);
    }
    for (const e of seed.events) {
      await client.query(
        `INSERT INTO events (id, organiser_id, name, type, county, area, venue, starts_at, ends_at, expected_guests, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [e.id, e.organiser_id, e.name, e.type, e.county, e.area, e.venue, e.starts_at, e.ends_at, e.expected_guests, e.status, e.created_at],
      );
    }
    for (const r of seed.roles) {
      await client.query(
        `INSERT INTO roles (id, event_id, title, category, headcount, filled, shift_start, shift_end, pay_per_shift, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [r.id, r.event_id, r.title, r.category, r.headcount, r.filled, r.shift_start, r.shift_end, r.pay_per_shift, r.created_at],
      );
    }
    for (const o of seed.offers) {
      await client.query(
        'INSERT INTO offers (id, role_id, event_id, workers_offered, note, status, partner, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
        [o.id, o.role_id, o.event_id, o.workers_offered, o.note, o.status, o.partner, o.created_at],
      );
    }
    for (const t of seed.crewTrainings ?? []) {
      await client.query(
        `INSERT INTO crew_trainings (id, organiser_id, event_id, course_id, ujuzi_booking_id, crew_size, preferred_start, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [t.id, t.organiser_id, t.event_id, t.course_id, t.ujuzi_booking_id, t.crew_size, t.preferred_start, t.status, t.created_at, t.updated_at],
      );
    }
    for (const c of seed.certificateChecks ?? []) {
      await client.query(
        `INSERT INTO certificate_checks (id, organiser_id, certificate_no, valid, course_title, level, issued_on, holder, checked_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [c.id, c.organiser_id, c.certificate_no, c.valid, c.course_title, c.level, c.issued_on, c.holder, c.checked_at],
      );
    }
    await advanceSequences(client);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Loads the sample data into a database that has no users and no events, and leaves anything that
 * is already there alone. Returns whether it loaded. Two instances starting together cannot both load.
 */
export async function seedIfEmpty(pool: Pool, seed: SeedData = seedData): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [7351002]);
    const { rows } = await client.query<{ n: number }>('SELECT (SELECT count(*) FROM users)::int + (SELECT count(*) FROM events)::int AS n');
    if (rows[0].n > 0) return false;
    await seedPostgres(pool, seed);
    return true;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [7351002]).catch(() => undefined);
    client.release();
  }
}

// `npm run db:seed`: create the tables if needed, then load the sample data if the database is empty.
if (path.basename(process.argv[1] ?? '') === 'seed.ts') {
  loadEnvConfig(process.cwd());
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set; the in-memory store always starts from the sample data.');
    process.exit(1);
  }
  const pool = new Pool({ connectionString: url });
  migrate(pool)
    .then(() => seedIfEmpty(pool))
    .then((loaded) => console.log(loaded ? 'Sample data loaded.' : 'Database already has data; nothing loaded.'))
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
