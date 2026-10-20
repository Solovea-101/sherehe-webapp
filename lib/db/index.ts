import { createMemoryStore } from './memoryStore';
import type { Store } from './types';

// One store per process. Kept on globalThis because Next.js can load this module more than once
// (separate route bundles, hot reloads), and each copy would otherwise get its own in-memory data.
const STORE_KEY = Symbol.for('sherehe.store');
type WithStore = typeof globalThis & { [STORE_KEY]?: Promise<Store> };

async function openStore(): Promise<Store> {
  if (process.env.DATABASE_URL) {
    // pgStore.ts arrives in a later phase. Failing loudly beats quietly serving in-memory data
    // from a deployment that was meant to use PostgreSQL.
    throw new Error(
      'DATABASE_URL is set, but the PostgreSQL store is not built yet. Unset DATABASE_URL to use the in-memory store.',
    );
  }
  return createMemoryStore();
}

/** The store every handler uses: in-memory when DATABASE_URL is unset, PostgreSQL otherwise. */
export function getStore(): Promise<Store> {
  const g = globalThis as WithStore;
  g[STORE_KEY] ??= openStore();
  return g[STORE_KEY];
}
