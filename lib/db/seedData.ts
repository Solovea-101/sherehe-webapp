import type { EventRow, OfferRow, RoleRow, SeedData, UserRow } from './types';

// Sample data. Counties and areas follow Kazi Connect's (Westlands, Kilimani, Parklands, Ruaka,
// Kasarani, South B, Nyali) and role categories come from the shared list. All people, events and
// venues are made up. No offers are seeded: the first offer created gets ofr_4001.
const d = (iso: string) => new Date(iso);
const SEEDED_AT = d('2026-10-01T08:00:00Z');

const users: UserRow[] = [
  {
    id: 'usr_1001',
    email: 'organiser@sherehe.example',
    name: 'Sample Organiser',
    // Not a scrypt hash, so no password matches it: this account owns the sample events but
    // cannot be logged into.
    password_hash: 'seed-account-cannot-log-in',
    created_at: SEEDED_AT,
  },
];

const organiser_id = 'usr_1001';

const events: EventRow[] = [
  {
    id: 'evt_2001', organiser_id, name: 'Wanjiku and Otieno wedding', type: 'wedding',
    county: 'Nairobi', area: 'Westlands', venue: 'Sarit Expo Centre',
    starts_at: d('2026-12-05T14:00:00Z'), ends_at: d('2026-12-05T22:00:00Z'),
    expected_guests: 300, status: 'upcoming', created_at: SEEDED_AT,
  },
  {
    id: 'evt_2002', organiser_id, name: 'Mwangi Holdings annual conference', type: 'conference',
    county: 'Nairobi', area: 'Kilimani', venue: 'Kilimani Conference Hall',
    starts_at: d('2026-11-26T08:00:00Z'), ends_at: d('2026-11-26T17:00:00Z'),
    expected_guests: 180, status: 'upcoming', created_at: SEEDED_AT,
  },
  {
    id: 'evt_2003', organiser_id, name: 'Parklands Jazz Night', type: 'concert',
    county: 'Nairobi', area: 'Parklands', venue: 'Parklands Open Grounds',
    starts_at: d('2026-12-12T17:00:00Z'), ends_at: d('2026-12-12T23:00:00Z'),
    expected_guests: 800, status: 'upcoming', created_at: SEEDED_AT,
  },
  {
    id: 'evt_2004', organiser_id, name: 'Ruaka Staff Retreat', type: 'corporate',
    county: 'Kiambu', area: 'Ruaka', venue: 'Ruaka Garden Pavilion',
    starts_at: d('2026-11-14T09:00:00Z'), ends_at: d('2026-11-14T16:00:00Z'),
    expected_guests: 120, status: 'upcoming', created_at: SEEDED_AT,
  },
  {
    id: 'evt_2005', organiser_id, name: 'Kasarani Gospel Festival', type: 'concert',
    county: 'Nairobi', area: 'Kasarani', venue: 'Kasarani Grounds',
    starts_at: d('2026-12-19T12:00:00Z'), ends_at: d('2026-12-19T20:00:00Z'),
    expected_guests: 2500, status: 'upcoming', created_at: SEEDED_AT,
  },
  {
    id: 'evt_2006', organiser_id, name: 'Amina and Juma wedding', type: 'wedding',
    county: 'Mombasa', area: 'Nyali', venue: 'Nyali Beach Pavilion',
    starts_at: d('2026-12-27T15:00:00Z'), ends_at: d('2026-12-27T23:00:00Z'),
    expected_guests: 220, status: 'upcoming', created_at: SEEDED_AT,
  },
  {
    // Already over: lets the status filter prove it excludes events that can no longer be staffed.
    id: 'evt_2007', organiser_id, name: 'South B Product Launch', type: 'corporate',
    county: 'Nairobi', area: 'South B', venue: 'South B Community Hall',
    starts_at: d('2026-09-12T10:00:00Z'), ends_at: d('2026-09-12T15:00:00Z'),
    expected_guests: 90, status: 'completed', created_at: SEEDED_AT,
  },
];

const roles: RoleRow[] = [
  {
    id: 'rol_3001', event_id: 'evt_2001', title: 'Waiters', category: 'catering',
    headcount: 6, filled: 0, shift_start: d('2026-12-05T13:00:00Z'), shift_end: d('2026-12-05T23:00:00Z'),
    pay_per_shift: 1500, created_at: SEEDED_AT,
  },
  {
    id: 'rol_3002', event_id: 'evt_2001', title: 'Ushers', category: 'events',
    headcount: 4, filled: 0, shift_start: d('2026-12-05T13:30:00Z'), shift_end: d('2026-12-05T22:30:00Z'),
    pay_per_shift: 1200, created_at: SEEDED_AT,
  },
  {
    id: 'rol_3003', event_id: 'evt_2002', title: 'Registration ushers', category: 'events',
    headcount: 3, filled: 0, shift_start: d('2026-11-26T07:00:00Z'), shift_end: d('2026-11-26T17:00:00Z'),
    pay_per_shift: 1300, created_at: SEEDED_AT,
  },
  {
    id: 'rol_3004', event_id: 'evt_2002', title: 'Cleaners', category: 'cleaning',
    headcount: 4, filled: 0, shift_start: d('2026-11-26T07:00:00Z'), shift_end: d('2026-11-26T18:00:00Z'),
    pay_per_shift: 1000, created_at: SEEDED_AT,
  },
  {
    id: 'rol_3005', event_id: 'evt_2003', title: 'Security guards', category: 'security',
    headcount: 8, filled: 0, shift_start: d('2026-12-12T16:00:00Z'), shift_end: d('2026-12-13T00:00:00Z'),
    pay_per_shift: 1800, created_at: SEEDED_AT,
  },
  {
    id: 'rol_3006', event_id: 'evt_2003', title: 'Ushers', category: 'events',
    headcount: 6, filled: 0, shift_start: d('2026-12-12T16:00:00Z'), shift_end: d('2026-12-12T23:30:00Z'),
    pay_per_shift: 1200, created_at: SEEDED_AT,
  },
  {
    id: 'rol_3007', event_id: 'evt_2004', title: 'Caterers', category: 'catering',
    headcount: 5, filled: 0, shift_start: d('2026-11-14T08:00:00Z'), shift_end: d('2026-11-14T16:30:00Z'),
    pay_per_shift: 1500, created_at: SEEDED_AT,
  },
  {
    id: 'rol_3008', event_id: 'evt_2005', title: 'Security guards', category: 'security',
    headcount: 12, filled: 0, shift_start: d('2026-12-19T11:00:00Z'), shift_end: d('2026-12-19T21:00:00Z'),
    pay_per_shift: 1800, created_at: SEEDED_AT,
  },
  {
    id: 'rol_3009', event_id: 'evt_2005', title: 'Cleaners', category: 'cleaning',
    headcount: 6, filled: 0, shift_start: d('2026-12-19T11:00:00Z'), shift_end: d('2026-12-19T21:00:00Z'),
    pay_per_shift: 1000, created_at: SEEDED_AT,
  },
  {
    id: 'rol_3010', event_id: 'evt_2006', title: 'Waiters', category: 'catering',
    headcount: 5, filled: 0, shift_start: d('2026-12-27T14:00:00Z'), shift_end: d('2026-12-28T00:00:00Z'),
    pay_per_shift: 1500, created_at: SEEDED_AT,
  },
  {
    // The only role that is already full, so a "role is full" conflict can be tested on seed data.
    id: 'rol_3011', event_id: 'evt_2007', title: 'Ushers', category: 'events',
    headcount: 2, filled: 2, shift_start: d('2026-09-12T09:00:00Z'), shift_end: d('2026-09-12T15:30:00Z'),
    pay_per_shift: 1200, created_at: SEEDED_AT,
  },
];

const offers: OfferRow[] = [];

export const seedData: SeedData = { users, events, roles, offers };
