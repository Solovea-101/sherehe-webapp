// Runs before every test file. next/jest loads .env into process.env, and a developer's .env may
// point at a real database or partner. Tests always use the in-memory store and the local stub, so
// blank those settings (an empty string counts as "already set" and survives Next's own .env load).
process.env.DATABASE_URL = '';
process.env.UJUZI_API_KEY = '';
process.env.PARTNER_KEYS = '';

// Next.js loads next.config.ts with Node's own module loader, which builds the config in a different
// JavaScript realm from the one Jest runs Next in, and Next then fails to copy it ("object is not
// extensible"). This flag is Next's switch for exactly that case: load the config through Jest's
// require instead.
process.env.__NEXT_TEST_MODE = 'jest';
