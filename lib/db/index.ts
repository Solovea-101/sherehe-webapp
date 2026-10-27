import { Pool } from 'pg';
import { createMemoryStore } from './memoryStore';
import { migrate } from './migrate';
import { createPgStore } from './pgStore';
import { seedIfEmpty } from './seed';
import type { Store } from './types';

// One store per process. Kept on globalThis because Next.js can load this module more than once
// (separate route bundles, hot reloads), and each copy would otherwise get its own in-memory data
// or its own connection pool.
const STORE_KEY = Symbol.for('sherehe.store');
type WithStore = typeof globalThis & { [STORE_KEY]?: Promise<Store> };

async function openStore(): Promise<Store> {
  const url = process.env.DATABASE_URL;
  if (!url) return createMemoryStore();

  const pool = new Pool({ connectionString: url, max: 10 });
  // An idle connection dropping (the database restarting) must not crash the server.
  pool.on('error', (err) => console.error('PostgreSQL pool error:', err.message));
  try {
    const applied = await migrate(pool);
    if (applied.length) console.log(`Database migrated: ${applied.join(', ')}`);
    // Sample data on first start, as the README promises; SEED_SAMPLE_DATA=false turns it off.
    if (process.env.SEED_SAMPLE_DATA !== 'false' && (await seedIfEmpty(pool))) console.log('Sample data loaded.');
  } catch (err) {
    await pool.end().catch(() => undefined);
    throw err;
  }
  return createPgStore(pool);
}

/**
 * The store every handler uses: in-memory when DATABASE_URL is unset, PostgreSQL otherwise (tables
 * and sample data are created on first start). If opening it fails, the next call tries again.
 */
export function getStore(): Promise<Store> {
  const g = globalThis as WithStore;
  g[STORE_KEY] ??= openStore().catch((err: unknown) => {
    delete g[STORE_KEY]; // do not remember a failure: a database that was down may be up on the next request
    throw err;
  });
  return g[STORE_KEY];
}
