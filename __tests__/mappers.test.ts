import type { EventRow, OfferRow, RoleRow } from '@/lib/db/types';
import { toEvent, toIso, toOffer, toRole } from '@/lib/mappers';
import { EVENT_KEYS, OFFER_KEYS, ROLE_KEYS, keysOf } from './helpers/shapes';

describe('toIso', () => {
  it('writes UTC with a Z and drops milliseconds', () => {
    expect(toIso(new Date('2026-12-05T14:00:00Z'))).toBe('2026-12-05T14:00:00Z');
    expect(toIso(new Date('2026-12-05T14:00:00.789Z'))).toBe('2026-12-05T14:00:00Z');
    expect(toIso(new Date('2026-12-05T14:00:00.000Z'))).toBe('2026-12-05T14:00:00Z');
  });

  it('converts a non-UTC instant to UTC', () => {
    expect(toIso(new Date('2026-12-05T17:00:00+03:00'))).toBe('2026-12-05T14:00:00Z'); // Nairobi time
  });
});

describe('row mappers', () => {
  const created_at = new Date('2026-10-01T08:00:00Z');

  it('maps an event row to the contract shape and nothing else', () => {
    const row: EventRow = {
      id: 'evt_2001', organiser_id: 'usr_1001', name: 'N', type: 'wedding', county: 'Nairobi', area: 'Westlands',
      venue: 'V', starts_at: new Date('2026-12-05T14:00:00Z'), ends_at: new Date('2026-12-05T22:00:00Z'),
      expected_guests: 300, status: 'upcoming', created_at,
    };
    const event = toEvent(row);
    expect(keysOf(event)).toEqual(EVENT_KEYS);
    expect(event).not.toHaveProperty('organiser_id');
    expect(event).not.toHaveProperty('organiserId');
    expect(event).toMatchObject({ startsAt: '2026-12-05T14:00:00Z', endsAt: '2026-12-05T22:00:00Z', expectedGuests: 300 });
  });

  it('maps a role row to the contract shape and nothing else', () => {
    const row: RoleRow = {
      id: 'rol_3001', event_id: 'evt_2001', title: 'Waiters', category: 'catering', headcount: 6, filled: 1,
      shift_start: new Date('2026-12-05T13:00:00Z'), shift_end: new Date('2026-12-05T23:00:00Z'),
      pay_per_shift: 1500, created_at,
    };
    const role = toRole(row);
    expect(keysOf(role)).toEqual(ROLE_KEYS);
    expect(role).toMatchObject({ eventId: 'evt_2001', shiftStart: '2026-12-05T13:00:00Z', payPerShift: 1500, filled: 1 });
  });

  it('maps an offer row to the contract shape and nothing else', () => {
    const row: OfferRow = {
      id: 'ofr_4001', role_id: 'rol_3001', event_id: 'evt_2001', workers_offered: 6, note: '', status: 'pending', partner: 'kazi', created_at,
    };
    const offer = toOffer(row);
    expect(keysOf(offer)).toEqual(OFFER_KEYS);
    expect(offer).toMatchObject({ roleId: 'rol_3001', eventId: 'evt_2001', workersOffered: 6, note: '', createdAt: '2026-10-01T08:00:00Z' });
  });
});
