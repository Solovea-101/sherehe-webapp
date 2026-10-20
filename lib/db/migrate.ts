import fs from 'node:fs/promises';
import path from 'node:path';
import { loadEnvConfig } from '@next/env';
import { Pool } from 'pg';

const MIGRATIONS_DIR = path.join(process.cwd(), 'lib', 'db', 'migrations');
// Arbitrary constant. Two instances starting together take turns instead of racing.
const ADVISORY_LOCK_KEY = 7351001;

/**
 * Applies every .sql file in the migrations folder that has not been applied yet, in file-name
 * order, each inside its own transaction. Returns the names it applied (empty when up to date).
 */
export async function migrate(pool: Pool, dir: string = MIGRATIONS_DIR): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_KEY]);
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         version    text PRIMARY KEY,
         applied_at timestamptz NOT NULL DEFAULT now()
       )`,
    );
    const done = new Set(
      (await client.query<{ version: string }>('SELECT version FROM schema_migrations')).rows.map(
        (r) => r.version,
      ),
    );
    const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await fs.readFile(path.join(dir, file), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      applied.push(file);
    }
    return applied;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]).catch(() => undefined);
    client.release();
  }
}

// `npm run db:migrate`. Checked by file name rather than require.main because Next.js bundles this
// file into the server once pgStore uses it.
if (path.basename(process.argv[1] ?? '') === 'migrate.ts') {
  loadEnvConfig(process.cwd());
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set; there is nothing to migrate (the in-memory store needs no schema).');
    process.exit(1);
  }
  const pool = new Pool({ connectionString: url });
  migrate(pool)
    .then((applied) => {
      console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date.');
    })
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
