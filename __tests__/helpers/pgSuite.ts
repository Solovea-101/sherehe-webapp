/**
 * Opt-in: run the whole API test suite against a real PostgreSQL instead of the in-memory store.
 *
 *   TEST_DATABASE_URL=postgres://user@127.0.0.1:5432/sherehe_test USE_PG_FOR_API_TESTS=true npm test
 *
 * The database is wiped and re-seeded before each test file (the tables are created if needed), so
 * every file starts from the same sample data it gets in memory. Without both settings this file
 * does nothing.
 */
import { Pool } from 'pg';
import type { Store } from '@/lib/db/types';
import { resetDatabase } from './pgReset';

const url = process.env.TEST_DATABASE_URL;
const STORE_KEY = Symbol.for('sherehe.store');
type WithStore = typeof globalThis & { [STORE_KEY]?: Promise<Store> };

if (url && process.env.USE_PG_FOR_API_TESTS === 'true') {
  beforeAll(async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await resetDatabase(pool);
    } finally {
      await pool.end();
    }
    process.env.DATABASE_URL = url; // the app now opens PostgreSQL, through the real getStore()
    delete (globalThis as WithStore)[STORE_KEY];
  });

  afterAll(async () => {
    const g = globalThis as WithStore;
    const opened = g[STORE_KEY];
    delete g[STORE_KEY];
    process.env.DATABASE_URL = '';
    if (opened) await (await opened.catch(() => undefined))?.close();
  });
}
