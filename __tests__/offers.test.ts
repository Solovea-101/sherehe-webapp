import request from 'supertest';
import { getStore } from '@/lib/db';
import { useTestServer } from './helpers/server';
import { ISO_DATE, OFFER_KEYS, keysOf } from './helpers/shapes';

const app = useTestServer();

describe('GET /api/offers/{offerId} (K4)', () => {
  it('returns an offer with exactly the contract fields', async () => {
    const store = await getStore();
    const offer = await store.offers.create({
      role_id: 'rol_3001', event_id: 'evt_2001', workers_offered: 6, note: 'Six trained catering students',
    });

    const res = await request(app()).get(`/api/offers/${offer.id}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(keysOf(res.body)).toEqual(OFFER_KEYS);
    expect(res.body).toEqual({
      id: offer.id,
      roleId: 'rol_3001',
      eventId: 'evt_2001',
      workersOffered: 6,
      note: 'Six trained catering students',
      status: 'pending',
      createdAt: expect.stringMatching(ISO_DATE),
    });
  });

  it('shows the new status once the organiser has decided', async () => {
    const store = await getStore();
    const offer = await store.offers.create({ role_id: 'rol_3002', event_id: 'evt_2001', workers_offered: 2, note: '' });

    for (const status of ['accepted', 'declined'] as const) {
      await store.offers.setStatus(offer.id, status);
      const res = await request(app()).get(`/api/offers/${offer.id}`);
      expect(res.body.status).toBe(status);
    }
  });

  it('sends an empty note as "" rather than leaving it out or sending null', async () => {
    const store = await getStore();
    const offer = await store.offers.create({ role_id: 'rol_3003', event_id: 'evt_2002', workers_offered: 1, note: '' });
    const res = await request(app()).get(`/api/offers/${offer.id}`);
    expect(res.body.note).toBe('');
  });

  it('answers 404 { message } for an unknown offer', async () => {
    const res = await request(app()).get('/api/offers/ofr_9999');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Offer ofr_9999 not found' });
  });

  it('answers 404 for an offer that was withdrawn', async () => {
    const store = await getStore();
    const offer = await store.offers.create({ role_id: 'rol_3004', event_id: 'evt_2002', workers_offered: 1, note: 'x' });
    expect((await request(app()).get(`/api/offers/${offer.id}`)).status).toBe(200);
    await store.offers.delete(offer.id);
    expect((await request(app()).get(`/api/offers/${offer.id}`)).status).toBe(404);
  });

  it('answers 404 for a malformed id', async () => {
    const res = await request(app()).get('/api/offers/not-an-offer');
    expect(res.status).toBe(404);
    expect(keysOf(res.body)).toEqual(['message']);
  });
});
