import type { Pool } from 'pg';
import { migrate } from '@/lib/db/migrate';
import { seedPostgres } from '@/lib/db/seed';
import { seedData } from '@/lib/db/seedData';
import type { SeedData } from '@/lib/db/types';

// Where each id sequence starts, as in the migrations.
const SEQUENCE_STARTS: Array<[sequence: string, start: number]> = [
  ['user_id_seq', 1001], ['event_id_seq', 2001], ['role_id_seq', 3001],
  ['offer_id_seq', 4001], ['training_id_seq', 5001], ['check_id_seq', 7001],
];

/** Brings a test database to a known state: tables exist, are empty, ids restart, seed rows are loaded. */
export async function resetDatabase(pool: Pool, seed: SeedData = seedData): Promise<void> {
  await migrate(pool);
  await pool.query('TRUNCATE users, sessions, events, roles, offers, crew_trainings, certificate_checks CASCADE');
  for (const [sequence, start] of SEQUENCE_STARTS) await pool.query(`ALTER SEQUENCE ${sequence} RESTART WITH ${start}`);
  await seedPostgres(pool, seed);
}
