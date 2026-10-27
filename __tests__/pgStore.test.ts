import { Pool } from 'pg';
import { getStore } from '@/lib/db';
import { migrate } from '@/lib/db/migrate';
import { createPgStore } from '@/lib/db/pgStore';
import { seedIfEmpty } from '@/lib/db/seed';
import { seedData } from '@/lib/db/seedData';
import type { Store } from '@/lib/db/types';
import { resetDatabase } from './helpers/pgReset';
import { storeContract } from './helpers/storeContract';

// These need a real PostgreSQL. Without TEST_DATABASE_URL they are skipped, and `npm test` still
// passes on a clean clone. To run them:
//   TEST_DATABASE_URL=postgres://user@127.0.0.1:5432/sherehe_test npm test
const url = process.env.TEST_DATABASE_URL;

if (!url) {
  describe('PostgreSQL store', () => {
    it.skip('is skipped: set TEST_DATABASE_URL to a throwaway PostgreSQL database to run it', () => undefined);
  });
} else {
  const pool = new Pool({ connectionString: url, max: 10 });

  // The very same behaviour tests the in-memory store passes.
  storeContract(
    'PostgreSQL store',
    async (seed) => {
      await resetDatabase(pool, seed);
      return createPgStore(pool);
    },
  );

  describe('PostgreSQL store: what only a real database can show', () => {
    let store: Store;
    beforeEach(async () => {
      await resetDatabase(pool);
      store = createPgStore(pool);
    });
    afterAll(async () => {
      await pool.end();
    });

    const offer = { role_id: 'rol_3001', event_id: 'evt_2001', workers_offered: 3, note: '' };

    it('lets exactly one of many simultaneous offers on a role in (the unique index decides)', async () => {
      const results = await Promise.allSettled(Array.from({ length: 8 }, () => store.offers.create(offer)));
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((r) => r.status === 'rejected').every((r) => (r as PromiseRejectedResult).reason.name === 'StoreConflictError')).toBe(true);
    });

    it('never overfills a role when many accepts arrive together (the row lock decides)', async () => {
      // The API allows one pending offer per role, so lift that rule for this test only, to get
      // ten pending offers of 2 workers on a role with 6 places, and accept them all at once.
      await pool.query('DROP INDEX offers_one_pending_per_role');
      try {
        const ids: string[] = [];
        for (let i = 0; i < 10; i += 1) ids.push((await store.offers.create({ ...offer, workers_offered: 2 })).id);
        const results = await Promise.all(ids.map((id) => store.offers.decide(id, 'accepted')));
        expect(results.filter((r) => r.kind === 'ok')).toHaveLength(3);
        expect(results.filter((r) => r.kind === 'no_room')).toHaveLength(7);
        expect((await store.roles.get('rol_3001'))?.filled).toBe(6); // exactly the headcount, never more
      } finally {
        await pool.query('DELETE FROM offers');
        await pool.query("CREATE UNIQUE INDEX offers_one_pending_per_role ON offers (role_id) WHERE status = 'pending'");
      }
    });

    it('settles a withdraw racing an accept: one wins, the other sees the result, and the role agrees', async () => {
      const o = await store.offers.create(offer);
      const [accepted, withdrawn] = await Promise.all([store.offers.decide(o.id, 'accepted'), store.offers.withdraw(o.id)]);
      const outcome = [accepted.kind, withdrawn.kind].sort();
      // the accept won (the withdraw then saw a decided offer), or the withdraw won (the accept then found nothing)
      expect([['not_found', 'ok'], ['not_pending', 'ok']]).toContainEqual(outcome);
      const filled = (await store.roles.get('rol_3001'))?.filled;
      expect(filled).toBe(accepted.kind === 'ok' ? 3 : 0);
    });

    it('keeps id order numeric once ids pass four digits', async () => {
      await pool.query("ALTER SEQUENCE training_id_seq RESTART WITH 9998");
      const user = 'usr_1001';
      const base = { organiser_id: user, event_id: 'evt_2001', course_id: 'crs_501', crew_size: 1, preferred_start: new Date('2027-01-01T08:00:00Z'), status: 'pending' as const };
      const ids: string[] = [];
      for (let i = 0; i < 4; i += 1) ids.push((await store.crewTrainings.create({ ...base, ujuzi_booking_id: `bkg_${i}` })).id);
      expect(ids).toEqual(['trn_9998', 'trn_9999', 'trn_10000', 'trn_10001']);
      expect((await store.crewTrainings.listPending()).map((t) => t.id)).toEqual(ids); // not 10000 before 9998
    });

    it('returns an issue date as plain YYYY-MM-DD text, whatever the server’s timezone', async () => {
      const check = await store.certificateChecks.create({
        organiser_id: 'usr_1001', certificate_no: 'UJZ-2026-00123', valid: true, course_title: 'T',
        level: 'short-course', issued_on: '2026-08-14', holder: 'A B.',
      });
      expect(check.issued_on).toBe('2026-08-14');
      expect((await store.certificateChecks.listByOrganiser('usr_1001'))[0].issued_on).toBe('2026-08-14');
    });

    it('loads the sample data once, advances the id sequences past it, and then leaves the database alone', async () => {
      await pool.query('TRUNCATE users, sessions, events, roles, offers, crew_trainings, certificate_checks CASCADE');
      expect(await seedIfEmpty(pool)).toBe(true);
      expect((await store.events.list()).length).toBe(seedData.events.length);
      expect(await seedIfEmpty(pool)).toBe(false); // already has data
      expect((await store.events.list()).length).toBe(seedData.events.length);
      const created = await store.events.create({ ...seedData.events[0], name: 'After seed' });
      expect(created.id).toBe('evt_2008'); // the sequence moved past evt_2007
    });

    it('has nothing left to migrate once the schema is up to date', async () => {
      expect(await migrate(pool)).toEqual([]);
    });

    it('opens through getStore() from DATABASE_URL: tables made, sample data loaded, same store every time', async () => {
      const g = globalThis as typeof globalThis & { [k: symbol]: unknown };
      const key = Symbol.for('sherehe.store');
      const kept = g[key];
      delete g[key];
      await pool.query('DROP TABLE IF EXISTS schema_migrations, certificate_checks, crew_trainings, offers, roles, events, sessions, users CASCADE');
      await pool.query('DROP SEQUENCE IF EXISTS user_id_seq, event_id_seq, role_id_seq, offer_id_seq, training_id_seq, check_id_seq');
      process.env.DATABASE_URL = url;
      try {
        const opened = await getStore();
        expect(await getStore()).toBe(opened);
        expect((await opened.events.get('evt_2001'))?.name).toBe('Wanjiku and Otieno wedding');
        expect((await opened.users.create({ email: 'new@example.com', name: 'N', password_hash: 'h' })).id).toBe('usr_1002');
        await opened.close();
      } finally {
        process.env.DATABASE_URL = '';
        delete g[key];
        if (kept) g[key] = kept;
      }
    });

    it('does not load sample data when SEED_SAMPLE_DATA is false', async () => {
      const g = globalThis as typeof globalThis & { [k: symbol]: unknown };
      const key = Symbol.for('sherehe.store');
      const kept = g[key];
      delete g[key];
      await pool.query('TRUNCATE users, sessions, events, roles, offers, crew_trainings, certificate_checks CASCADE');
      process.env.DATABASE_URL = url;
      process.env.SEED_SAMPLE_DATA = 'false';
      try {
        const opened = await getStore();
        expect(await opened.events.list()).toEqual([]);
        await opened.close();
      } finally {
        delete process.env.SEED_SAMPLE_DATA;
        process.env.DATABASE_URL = '';
        delete g[key];
        if (kept) g[key] = kept;
      }
    });
  });
}
