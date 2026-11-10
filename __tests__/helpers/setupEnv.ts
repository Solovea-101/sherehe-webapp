// Runs before every test file. next/jest loads .env into process.env, and a developer's .env may
// point at a real database or partner. Tests always use the in-memory store and the local stub, so
// blank those settings (an empty string counts as "already set" and survives Next's own .env load).
process.env.DATABASE_URL = '';
process.env.PARTNER_KEYS = '';
// The partner API refuses everyone when no key is set. Most suites predate that and call it without
// a key, so they ask for it open (never honoured in production); partnerKey.test.ts turns this off.
process.env.ALLOW_OPEN_PARTNER_API = 'true';
// One JSON line for every request would bury the test output. monitoring.test.ts turns the log on.
process.env.REQUEST_LOG = 'false';
// The tests send hundreds of requests a second from one address; the limiter has its own tests.
process.env.RATE_LIMIT_MAX = '0';
// A failed read is tried up to twice more, 200 ms and then 400 ms apart. Tests that fail on purpose would wait that
// long every time, so they wait 5 ms; the tests of the delays themselves put the default back.
process.env.UJUZI_RETRY_DELAY_MS = '5';
// `npm run test:partner` aims at the real Ujuzi on purpose, so it keeps the Ujuzi settings it was given.
if (process.env.PARTNER_TESTS !== 'true') {
  process.env.UJUZI_API_URL = ''; // tests that need Ujuzi point this at the local stub
  process.env.UJUZI_API_KEY = '';
}

// Next.js loads next.config.ts with Node's own module loader, which builds the config in a different
// JavaScript realm from the one Jest runs Next in, and Next then fails to copy it ("object is not
// extensible"). This flag is Next's switch for exactly that case: load the config through Jest's
// require instead.
process.env.__NEXT_TEST_MODE = 'jest';

// Every test file builds its own Next.js instance, and each one registers its own
// uncaughtException handler on the one real process the files share (--runInBand). That is
// harmless here; raise the cap so Node's leak warning does not bury real warnings. (Jest gives each
// file a copy of `process`, so the default every emitter falls back to is what has to change.)
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('node:events').EventEmitter.defaultMaxListeners = 100;
