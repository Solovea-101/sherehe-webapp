import request from 'supertest';
import { getStore } from '@/lib/db';
import type { ApiRole } from '@/lib/mappers';
import { useTestServer } from './helpers/server';
import { ISO_DATE, ROLE_KEYS, keysOf } from './helpers/shapes';

const app = useTestServer();

describe('GET /api/events/{eventId}/roles (K2)', () => {
  it('lists the roles of an event as a bare array', async () => {
    const res = await request(app()).get('/api/events/evt_2001/roles');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.body).toEqual([
      {
        id: 'rol_3001', eventId: 'evt_2001', title: 'Waiters', category: 'catering', headcount: 6, filled: 0,
        shiftStart: '2026-12-05T13:00:00Z', shiftEnd: '2026-12-05T23:00:00Z', payPerShift: 1500,
      },
      {
        id: 'rol_3002', eventId: 'evt_2001', title: 'Ushers', category: 'events', headcount: 4, filled: 0,
        shiftStart: '2026-12-05T13:30:00Z', shiftEnd: '2026-12-05T22:30:00Z', payPerShift: 1200,
      },
    ]);
  });

  it('returns exactly the contract fields, with ISO dates and whole-number money', async () => {
    const res = await request(app()).get('/api/events/evt_2005/roles');
    expect(res.body.length).toBe(2);
    for (const role of res.body as ApiRole[]) {
      expect(keysOf(role)).toEqual(ROLE_KEYS);
      expect(role.eventId).toBe('evt_2005');
      expect(role.shiftStart).toMatch(ISO_DATE);
      expect(role.shiftEnd).toMatch(ISO_DATE);
      expect(Number.isInteger(role.payPerShift)).toBe(true);
      expect(Number.isInteger(role.headcount) && Number.isInteger(role.filled)).toBe(true);
    }
  });

  it('only returns roles of the requested event, with categories from the shared list', async () => {
    const shared = ['accommodation', 'campus', 'catering', 'cleaning', 'electrical', 'events', 'plumbing', 'security', 'tutoring'];
    for (const id of ['evt_2001', 'evt_2002', 'evt_2003', 'evt_2004', 'evt_2005', 'evt_2006']) {
      const res = await request(app()).get(`/api/events/${id}/roles`);
      expect(res.status).toBe(200);
      expect(res.body.length).toBeGreaterThan(0);
      for (const role of res.body as ApiRole[]) {
        expect(role.eventId).toBe(id);
        expect(shared).toContain(role.category);
      }
    }
  });

  it('answers 200 with [] for an event that has no roles yet', async () => {
    const store = await getStore();
    const bare = await store.events.create({
      organiser_id: 'usr_1001', name: 'No roles yet', type: 'other', county: 'Nakuru', area: 'Milimani',
      venue: 'Hall', starts_at: new Date('2027-02-01T10:00:00Z'), ends_at: new Date('2027-02-01T12:00:00Z'),
      expected_guests: 10, status: 'upcoming',
    });
    const res = await request(app()).get(`/api/events/${bare.id}/roles`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('shows a role that is already full, and a role added after the server started', async () => {
    const full = await request(app()).get('/api/events/evt_2007/roles');
    expect(full.status).toBe(200);
    expect(full.body[0]).toMatchObject({ id: 'rol_3011', headcount: 2, filled: 2 });

    const store = await getStore();
    const added = await store.roles.create({
      event_id: 'evt_2006', title: 'Bartenders', category: 'catering', headcount: 2, filled: 0,
      shift_start: new Date('2026-12-27T14:00:00.500Z'), shift_end: new Date('2026-12-27T23:00:00Z'), pay_per_shift: 1600,
    });
    const res = await request(app()).get('/api/events/evt_2006/roles');
    expect(res.body.map((r: ApiRole) => r.id)).toEqual(['rol_3010', added.id]);
    expect(res.body[1].shiftStart).toBe('2026-12-27T14:00:00Z');
  });

  it('answers 404 { message } for an unknown event, not []', async () => {
    const res = await request(app()).get('/api/events/evt_9999/roles');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Event evt_9999 not found' });
  });

  it('does not treat a role id as an event id', async () => {
    const res = await request(app()).get('/api/events/rol_3001/roles');
    expect(res.status).toBe(404);
  });
});
