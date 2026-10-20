import { getStore } from '@/lib/db';
import { createMemoryStore } from '@/lib/db/memoryStore';
import { seedData } from '@/lib/db/seedData';
import { StoreConflictError, type SeedData, type Store } from '@/lib/db/types';

const emptySeed: SeedData = { users: [], events: [], roles: [], offers: [] };
const SHARED_CATEGORIES = [
  'accommodation', 'campus', 'catering', 'cleaning', 'electrical', 'events', 'plumbing', 'security', 'tutoring',
];
// Kazi's seed areas and the county each belongs to.
const KAZI_AREAS: Record<string, string> = {
  Westlands: 'Nairobi', Kilimani: 'Nairobi', Parklands: 'Nairobi', Kasarani: 'Nairobi',
  'South B': 'Nairobi', Ruaka: 'Kiambu', Nyali: 'Mombasa',
};

const newEvent = (organiser_id: string) => ({
  organiser_id,
  name: 'Test gala', type: 'other' as const, county: 'Kisumu', area: 'Milimani', venue: 'Test Hall',
  starts_at: new Date('2027-01-10T10:00:00Z'), ends_at: new Date('2027-01-10T18:00:00Z'),
  expected_guests: 50, status: 'upcoming' as const,
});

describe('seed data (R5 alignment)', () => {
  it('uses Kazi’s areas, each in its own county', () => {
    for (const e of seedData.events) {
      expect(KAZI_AREAS[e.area]).toBe(e.county);
    }
    expect(new Set(seedData.events.map((e) => e.area))).toEqual(new Set(Object.keys(KAZI_AREAS)));
  });

  it('uses only categories from the shared list', () => {
    for (const r of seedData.roles) expect(SHARED_CATEGORIES).toContain(r.category);
  });

  it('keeps every role inside its event, with sensible numbers', () => {
    const eventIds = new Set(seedData.events.map((e) => e.id));
    for (const r of seedData.roles) {
      expect(eventIds.has(r.event_id)).toBe(true);
      expect(r.filled).toBeLessThanOrEqual(r.headcount);
      expect(r.shift_end.getTime()).toBeGreaterThan(r.shift_start.getTime());
      expect(Number.isInteger(r.pay_per_shift)).toBe(true);
    }
  });

  it('uses prefixed ids', () => {
    expect(seedData.events.every((e) => /^evt_\d+$/.test(e.id))).toBe(true);
    expect(seedData.roles.every((r) => /^rol_\d+$/.test(r.id))).toBe(true);
  });
});

describe('memory store: events', () => {
  let store: Store;
  beforeEach(() => {
    store = createMemoryStore();
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
    const empty = createMemoryStore(emptySeed);
    const user = await empty.users.create({ email: 'a@b.co', name: 'A', password_hash: 'x' });
    expect(user.id).toBe('usr_1001');
    expect((await empty.events.create(newEvent(user.id))).id).toBe('evt_2001');
  });

  it('refuses an event for an organiser that does not exist', async () => {
    await expect(store.events.create(newEvent('usr_9999'))).rejects.toThrow('usr_9999 does not exist');
  });

  it('hands out copies, so callers cannot change stored rows', async () => {
    const first = await store.events.get('evt_2001');
    if (!first) throw new Error('seed event missing');
    first.name = 'Changed';
    expect((await store.events.get('evt_2001'))?.name).toBe('Wanjiku and Otieno wedding');
  });

  it('does not let one store’s writes leak into another or into the seed', async () => {
    await store.events.create(newEvent('usr_1001'));
    expect(await createMemoryStore().events.get('evt_2008')).toBeNull();
    expect(seedData.events).toHaveLength(7);
  });
});

describe('memory store: roles', () => {
  let store: Store;
  beforeEach(() => {
    store = createMemoryStore();
  });

  it('lists an event’s roles, [] when it has none, [] for an unknown event', async () => {
    expect((await store.roles.listByEvent('evt_2001')).map((r) => r.id)).toEqual(['rol_3001', 'rol_3002']);
    expect(await store.roles.listByEvent('evt_2006')).toHaveLength(1);
    const created = await store.events.create(newEvent('usr_1001'));
    expect(await store.roles.listByEvent(created.id)).toEqual([]);
    expect(await store.roles.listByEvent('evt_9999')).toEqual([]);
  });

  it('creates a role with the next id and refuses an unknown event', async () => {
    const role = await store.roles.create({
      event_id: 'evt_2006', title: 'Bartenders', category: 'catering', headcount: 2, filled: 0,
      shift_start: new Date('2026-12-27T14:00:00Z'), shift_end: new Date('2026-12-27T23:00:00Z'),
      pay_per_shift: 1600,
    });
    expect(role.id).toBe('rol_3012');
    expect(await store.roles.get('rol_3012')).toEqual(role);
    await expect(store.roles.create({ ...role, event_id: 'evt_9999' })).rejects.toThrow('evt_9999 does not exist');
  });

  it('gets one role, or null', async () => {
    expect((await store.roles.get('rol_3001'))?.title).toBe('Waiters');
    expect(await store.roles.get('rol_9999')).toBeNull();
  });
});

describe('memory store: offers', () => {
  let store: Store;
  beforeEach(() => {
    store = createMemoryStore();
  });

  const offer = { role_id: 'rol_3001', event_id: 'evt_2001', workers_offered: 6, note: 'Six trained students' };

  it('creates offers as pending, starting at ofr_4001', async () => {
    const created = await store.offers.create(offer);
    expect(created).toMatchObject({ id: 'ofr_4001', status: 'pending', workers_offered: 6 });
    expect((await store.offers.create(offer)).id).toBe('ofr_4002');
  });

  it('refuses an offer on a role or event that does not exist', async () => {
    await expect(store.offers.create({ ...offer, role_id: 'rol_9999' })).rejects.toThrow('rol_9999 does not exist');
    await expect(store.offers.create({ ...offer, event_id: 'evt_9999' })).rejects.toThrow('evt_9999 does not exist');
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

describe('memory store: users and sessions', () => {
  let store: Store;
  beforeEach(() => {
    store = createMemoryStore();
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

describe('getStore', () => {
  const KEY = Symbol.for('sherehe.store');
  const forget = () => {
    delete (globalThis as unknown as Record<symbol, unknown>)[KEY];
  };
  afterEach(() => {
    process.env.DATABASE_URL = '';
    forget();
  });

  it('is in-memory when DATABASE_URL is unset, and one store per process', async () => {
    forget();
    const first = await getStore();
    expect(await getStore()).toBe(first);
    expect((await first.events.get('evt_2001'))?.id).toBe('evt_2001');
  });

  it('refuses to fall back silently when DATABASE_URL is set but there is no PostgreSQL store yet', async () => {
    forget();
    process.env.DATABASE_URL = 'postgres://example.invalid/sherehe';
    await expect(getStore()).rejects.toThrow('PostgreSQL store is not built yet');
  });
});
