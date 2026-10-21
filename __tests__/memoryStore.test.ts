import { getStore } from '@/lib/db';
import { createMemoryStore } from '@/lib/db/memoryStore';
import { seedData } from '@/lib/db/seedData';
import { storeContract } from './helpers/storeContract';


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

storeContract('memory store', async (seed) => createMemoryStore(seed));

describe('memory store: separate instances', () => {
  it('does not let one store’s writes leak into another or into the seed', async () => {
    const store = createMemoryStore();
    await store.events.create(newEvent('usr_1001'));
    expect(await createMemoryStore().events.get('evt_2008')).toBeNull();
    expect(seedData.events).toHaveLength(7);
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

  it('fails loudly, rather than quietly using memory, when DATABASE_URL points at a database that is not there', async () => {
    forget();
    process.env.DATABASE_URL = 'postgres://nobody@127.0.0.1:1/sherehe'; // port 1: nothing listens
    await expect(getStore()).rejects.toThrow();
  });

  it('does not remember that failure: once the database is reachable (or the setting is removed) the next call works', async () => {
    forget();
    process.env.DATABASE_URL = 'postgres://nobody@127.0.0.1:1/sherehe';
    await expect(getStore()).rejects.toThrow();
    process.env.DATABASE_URL = '';
    const store = await getStore();
    expect((await store.events.get('evt_2001'))?.id).toBe('evt_2001');
  });
});
