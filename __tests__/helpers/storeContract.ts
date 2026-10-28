import { StoreConflictError, type SeedData, type Store } from '@/lib/db/types';

export const emptySeed: SeedData = { users: [], events: [], roles: [], offers: [] };

const newEvent = (organiser_id: string) => ({
  organiser_id,
  name: 'Test gala', type: 'other' as const, county: 'Kisumu', area: 'Milimani', venue: 'Test Hall',
  starts_at: new Date('2027-01-10T10:00:00Z'), ends_at: new Date('2027-01-10T18:00:00Z'),
  expected_guests: 50, status: 'upcoming' as const,
});

/**
 * Everything the handlers may ask of a Store, as tests. The in-memory store and the PostgreSQL store
 * must both pass this exact suite, which is what "identical behaviour" means. `make` returns a store
 * holding the sample data (or the seed it is given); `done` releases whatever the suite opened.
 */
export function storeContract(label: string, make: (seed?: SeedData) => Promise<Store>, done?: () => Promise<void>): void {
  if (done) afterAll(done);

  describe(`${label}: events`, () => {
    let store: Store;
    beforeEach(async () => {
      store = await make();
    });

    it('lists upcoming events soonest first and leaves out events that are over', async () => {
      const upcoming = await store.events.list({ status: 'upcoming' });
      expect(upcoming.length).toBeGreaterThan(0);
      expect(upcoming.every((e) => e.status === 'upcoming')).toBe(true);
      const times = upcoming.map((e) => e.starts_at.getTime());
      expect(times).toEqual([...times].sort((a, b) => a - b));
      expect(upcoming.find((e) => e.id === 'evt_2007')).toBeUndefined();
    });

    it('filters by county ignoring case', async () => {
      const lower = await store.events.list({ status: 'upcoming', county: 'nairobi' });
      const upper = await store.events.list({ status: 'upcoming', county: 'NAIROBI' });
      expect(lower.length).toBeGreaterThan(0);
      expect(lower).toEqual(upper);
      expect(lower.every((e) => e.county === 'Nairobi')).toBe(true);
    });

    it('answers [] when nothing matches', async () => {
      expect(await store.events.list({ county: 'Turkana' })).toEqual([]);
    });

    it('gets one event, or null', async () => {
      expect((await store.events.get('evt_2001'))?.name).toBe('Wanjiku and Otieno wedding');
      expect(await store.events.get('evt_9999')).toBeNull();
    });

    it('numbers new events after the seeded ones and keeps them', async () => {
      const created = await store.events.create(newEvent('usr_1001'));
      expect(created.id).toBe('evt_2008');
      expect(created.created_at).toBeInstanceOf(Date);
      expect(await store.events.get('evt_2008')).toEqual(created);
    });

    it('starts numbering at evt_2001 from an empty seed', async () => {
      const empty = await make(emptySeed);
      const user = await empty.users.create({ email: 'a@b.co', name: 'A', password_hash: 'x' });
      expect(user.id).toBe('usr_1001');
      expect((await empty.events.create(newEvent(user.id))).id).toBe('evt_2001');
    });

    it('refuses an event for an organiser that does not exist', async () => {
      await expect(store.events.create(newEvent('usr_9999'))).rejects.toThrow('usr_9999');
    });

    it('hands out copies, so callers cannot change stored rows', async () => {
      const first = await store.events.get('evt_2001');
      if (!first) throw new Error('seed event missing');
      first.name = 'Changed';
      expect((await store.events.get('evt_2001'))?.name).toBe('Wanjiku and Otieno wedding');
    });

  });

  describe(`${label}: roles`, () => {
    let store: Store;
    beforeEach(async () => {
      store = await make();
    });

    it('lists an event’s roles, [] when it has none, [] for an unknown event', async () => {
      expect((await store.roles.listByEvent('evt_2001')).map((r) => r.id)).toEqual(['rol_3001', 'rol_3002']);
      expect(await store.roles.listByEvent('evt_2006')).toHaveLength(1);
      const created = await store.events.create(newEvent('usr_1001'));
      expect(await store.roles.listByEvent(created.id)).toEqual([]);
      expect(await store.roles.listByEvent('evt_9999')).toEqual([]);
    });

    it('lists the roles of several events in one go, ordered by id; nothing for none or unknown', async () => {
      const both = await store.roles.listByEvents(['evt_2006', 'evt_2001']);
      expect(both.map((r) => r.id)).toEqual(['rol_3001', 'rol_3002', ...(await store.roles.listByEvent('evt_2006')).map((r) => r.id)].sort());
      expect(both.every((r) => ['evt_2001', 'evt_2006'].includes(r.event_id))).toBe(true);
      expect(await store.roles.listByEvents([])).toEqual([]);
      expect(await store.roles.listByEvents(['evt_9999'])).toEqual([]);
    });

    it('creates a role with the next id and refuses an unknown event', async () => {
      const role = await store.roles.create({
        event_id: 'evt_2006', title: 'Bartenders', category: 'catering', headcount: 2, filled: 0,
        shift_start: new Date('2026-12-27T14:00:00Z'), shift_end: new Date('2026-12-27T23:00:00Z'),
        pay_per_shift: 1600,
      });
      expect(role.id).toBe('rol_3012');
      expect(await store.roles.get('rol_3012')).toEqual(role);
      await expect(store.roles.create({ ...role, event_id: 'evt_9999' })).rejects.toThrow('evt_9999');
    });

    it('gets one role, or null', async () => {
      expect((await store.roles.get('rol_3001'))?.title).toBe('Waiters');
      expect(await store.roles.get('rol_9999')).toBeNull();
    });
  });

  describe(`${label}: offers`, () => {
    let store: Store;
    beforeEach(async () => {
      store = await make();
    });

    const offer = { role_id: 'rol_3001', event_id: 'evt_2001', workers_offered: 6, note: 'Six trained students' };

    it('creates offers as pending, starting at ofr_4001', async () => {
      const created = await store.offers.create(offer);
      expect(created).toMatchObject({ id: 'ofr_4001', status: 'pending', workers_offered: 6 });
      expect((await store.offers.create({ ...offer, role_id: 'rol_3002' })).id).toBe('ofr_4002');
    });

    it('allows only one pending offer per role, until it is decided or withdrawn', async () => {
      const first = await store.offers.create(offer);
      await expect(store.offers.create(offer)).rejects.toBeInstanceOf(StoreConflictError);
      expect((await store.offers.findPendingByRole('rol_3001'))?.id).toBe(first.id);

      await store.offers.decide(first.id, 'declined');
      expect(await store.offers.findPendingByRole('rol_3001')).toBeNull();
      const second = await store.offers.create(offer); // the role is open to offers again
      // Ids only have to be new and increasing. PostgreSQL skips a number when an insert is rejected
      // (the refused duplicate above used one), so the exact next id is not part of the contract.
      expect(second.id).toMatch(/^ofr_\d+$/);
      expect(Number(second.id.slice(4))).toBeGreaterThan(Number(first.id.slice(4)));

      await store.offers.withdraw(second.id);
      expect((await store.offers.create(offer)).status).toBe('pending');
    });

    describe('decide', () => {
      it('accepting fills places on the role; declining does not', async () => {
        const a = await store.offers.create({ ...offer, workers_offered: 4 });
        const result = await store.offers.decide(a.id, 'accepted');
        expect(result).toMatchObject({ kind: 'ok', offer: { id: a.id, status: 'accepted' } });
        expect((await store.roles.get('rol_3001'))?.filled).toBe(4);

        const b = await store.offers.create({ ...offer, workers_offered: 2 });
        await store.offers.decide(b.id, 'declined');
        expect((await store.roles.get('rol_3001'))?.filled).toBe(4);
      });

      it('refuses to overfill a role and leaves the offer pending', async () => {
        const big = await store.offers.create({ ...offer, workers_offered: 6 });
        await store.offers.decide(big.id, 'accepted'); // rol_3001 is now full (6 of 6)
        const late = await store.offers.create({ ...offer, workers_offered: 1 });
        expect(await store.offers.decide(late.id, 'accepted')).toEqual({ kind: 'no_room', openPlaces: 0 });
        expect((await store.offers.get(late.id))?.status).toBe('pending');
        expect((await store.roles.get('rol_3001'))?.filled).toBe(6);
      });

      it('decisions are final, and unknown offers are reported', async () => {
        const a = await store.offers.create(offer);
        await store.offers.decide(a.id, 'declined');
        expect(await store.offers.decide(a.id, 'accepted')).toMatchObject({ kind: 'not_pending', offer: { status: 'declined' } });
        expect(await store.offers.decide('ofr_9999', 'accepted')).toEqual({ kind: 'not_found' });
      });
    });

    describe('withdraw', () => {
      it('removes a pending offer only', async () => {
        const a = await store.offers.create(offer);
        expect(await store.offers.withdraw(a.id)).toEqual({ kind: 'ok' });
        expect(await store.offers.get(a.id)).toBeNull();
        expect(await store.offers.withdraw(a.id)).toEqual({ kind: 'not_found' });

        const b = await store.offers.create(offer);
        await store.offers.decide(b.id, 'accepted');
        expect(await store.offers.withdraw(b.id)).toMatchObject({ kind: 'not_pending', offer: { status: 'accepted' } });
        expect((await store.offers.get(b.id))?.status).toBe('accepted');
      });
    });

    it('refuses an offer on a role or event that does not exist', async () => {
      await expect(store.offers.create({ ...offer, role_id: 'rol_9999' })).rejects.toThrow('rol_9999');
      await expect(store.offers.create({ ...offer, event_id: 'evt_9999' })).rejects.toThrow('evt_9999');
    });

    it('gets, decides and deletes an offer', async () => {
      const created = await store.offers.create(offer);
      expect(await store.offers.get(created.id)).toEqual(created);

      const decided = await store.offers.setStatus(created.id, 'accepted');
      expect(decided?.status).toBe('accepted');
      expect((await store.offers.get(created.id))?.status).toBe('accepted');

      expect(await store.offers.delete(created.id)).toBe(true);
      expect(await store.offers.get(created.id)).toBeNull();
      expect(await store.offers.delete(created.id)).toBe(false);
      expect(await store.offers.setStatus(created.id, 'declined')).toBeNull();
    });

    it('lists an event’s offers oldest first', async () => {
      const a = await store.offers.create(offer);
      const b = await store.offers.create({ ...offer, role_id: 'rol_3002', workers_offered: 2 });
      expect((await store.offers.listByEvent('evt_2001')).map((o) => o.id)).toEqual([a.id, b.id]);
      expect(await store.offers.listByEvent('evt_2002')).toEqual([]);
    });
  });

  describe(`${label}: crew trainings`, () => {
    let store: Store;
    beforeEach(async () => {
      store = await make();
    });
    const training = {
      organiser_id: 'usr_1001', event_id: 'evt_2001', course_id: 'crs_501', ujuzi_booking_id: 'bkg_6001',
      crew_size: 6, preferred_start: new Date('2026-11-28T08:00:00Z'), status: 'pending' as const,
    };

    it('creates, reads, updates and deletes', async () => {
      const created = await store.crewTrainings.create(training);
      expect(created).toMatchObject({ id: 'trn_5001', status: 'pending', crew_size: 6 });
      expect(created.created_at).toEqual(created.updated_at);
      expect(await store.crewTrainings.get('trn_5001')).toEqual(created);

      const updated = await store.crewTrainings.update(created.id, { crew_size: 8, status: 'confirmed' });
      expect(updated).toMatchObject({ crew_size: 8, status: 'confirmed', course_id: 'crs_501' });
      expect(updated!.updated_at.getTime()).toBeGreaterThanOrEqual(created.updated_at.getTime());

      expect(await store.crewTrainings.delete(created.id)).toBe(true);
      expect(await store.crewTrainings.get(created.id)).toBeNull();
      expect(await store.crewTrainings.delete(created.id)).toBe(false);
      expect(await store.crewTrainings.update(created.id, { crew_size: 1 })).toBeNull();
    });

    it('lists an organiser’s trainings newest first, and every pending one for the poller', async () => {
      const other = await store.users.create({ email: 'o@example.com', name: 'O', password_hash: 'h' });
      const a = await store.crewTrainings.create(training);
      const b = await store.crewTrainings.create({ ...training, ujuzi_booking_id: 'bkg_6002' });
      const c = await store.crewTrainings.create({ ...training, ujuzi_booking_id: 'bkg_6003', organiser_id: other.id });
      await store.crewTrainings.update(b.id, { status: 'declined' });

      expect((await store.crewTrainings.listByOrganiser('usr_1001')).map((t) => t.id)).toEqual([b.id, a.id]);
      expect((await store.crewTrainings.listPending()).map((t) => t.id)).toEqual([a.id, c.id]);
      expect(await store.crewTrainings.listByOrganiser('usr_9999')).toEqual([]);
    });

    it('refuses a missing organiser or event, and a booking recorded twice', async () => {
      await expect(store.crewTrainings.create({ ...training, organiser_id: 'usr_9999' })).rejects.toThrow('does not exist');
      await expect(store.crewTrainings.create({ ...training, event_id: 'evt_9999' })).rejects.toThrow('does not exist');
      await store.crewTrainings.create(training);
      await expect(store.crewTrainings.create(training)).rejects.toBeInstanceOf(StoreConflictError);
    });
  });

  describe(`${label}: certificate checks`, () => {
    it('records checks and lists an organiser’s newest first', async () => {
      const store = await make();
      const check = {
        organiser_id: 'usr_1001', certificate_no: 'UJZ-2026-00123', valid: true, course_title: 'Food hygiene',
        level: 'short-course' as const, issued_on: '2026-08-14', holder: 'Achieng O.',
      };
      const first = await store.certificateChecks.create(check);
      const second = await store.certificateChecks.create({ ...check, valid: false });
      expect(first).toMatchObject({ id: 'chk_7001', valid: true });
      expect(first.checked_at).toBeInstanceOf(Date);
      expect((await store.certificateChecks.listByOrganiser('usr_1001')).map((c) => c.id)).toEqual([second.id, first.id]);
      expect(await store.certificateChecks.listByOrganiser('usr_9999')).toEqual([]);
      await expect(store.certificateChecks.create({ ...check, organiser_id: 'usr_9999' })).rejects.toThrow('does not exist');
    });
  });

  describe(`${label}: users and sessions`, () => {
    let store: Store;
    beforeEach(async () => {
      store = await make();
    });

    it('creates users, matching email ignoring case', async () => {
      const user = await store.users.create({ email: 'Amina@Example.com', name: 'Amina', password_hash: 'h' });
      expect(user.email).toBe('amina@example.com');
      expect(user.id).toBe('usr_1002');
      expect((await store.users.findByEmail('AMINA@example.COM'))?.id).toBe('usr_1002');
      expect((await store.users.findById('usr_1002'))?.name).toBe('Amina');
      expect(await store.users.findByEmail('nobody@example.com')).toBeNull();
      expect(await store.users.findById('usr_9999')).toBeNull();
    });

    it('throws StoreConflictError for a second account with the same email', async () => {
      await store.users.create({ email: 'amina@example.com', name: 'Amina', password_hash: 'h' });
      await expect(
        store.users.create({ email: 'AMINA@example.com', name: 'Other', password_hash: 'h' }),
      ).rejects.toBeInstanceOf(StoreConflictError);
    });

    it('keeps sessions by token hash until they are deleted', async () => {
      const expires_at = new Date('2027-01-01T00:00:00Z');
      await store.sessions.create({ token_hash: 'abc', user_id: 'usr_1001', expires_at });
      expect(await store.sessions.findByTokenHash('abc')).toMatchObject({ user_id: 'usr_1001', expires_at });
      await expect(
        store.sessions.create({ token_hash: 'abc', user_id: 'usr_1001', expires_at }),
      ).rejects.toBeInstanceOf(StoreConflictError);
      expect(await store.sessions.delete('abc')).toBe(true);
      expect(await store.sessions.findByTokenHash('abc')).toBeNull();
      expect(await store.sessions.delete('abc')).toBe(false);
    });
  });
}
