import request from 'supertest';
import { sha256Hex } from '@/lib/auth/hash';
import { isIssuedKey, readPartnerKeyConfig } from '@/lib/auth/partnerKey';
import { getStore } from '@/lib/db';
import { newOrganiser } from './helpers/auth';
import { inDays } from './helpers/dates';
import { useTestServer } from './helpers/server';

const app = useTestServer();

const KAZI_KEY = 'shk_kazi-connect-test-key-0123456789';
const OTHER_KEY = 'shk_a-second-system-test-key-abcdef';
const WARNED = Symbol.for('sherehe.partnerKeyWarned');

const setKeys = (value: string, required?: boolean) => {
  process.env.PARTNER_KEYS = value;
  if (required) process.env.REQUIRE_PARTNER_KEY = 'true';
  else delete process.env.REQUIRE_PARTNER_KEY;
  delete (globalThis as { [k: symbol]: unknown })[WARNED];
};
afterEach(() => {
  process.env.PARTNER_KEYS = '';
  delete process.env.REQUIRE_PARTNER_KEY;
  jest.restoreAllMocks();
});

describe('reading PARTNER_KEYS', () => {
  it('takes comma-separated SHA-256 hashes, ignoring spaces and letter case', () => {
    const a = sha256Hex(KAZI_KEY);
    const b = sha256Hex(OTHER_KEY).toUpperCase();
    const config = readPartnerKeyConfig({ PARTNER_KEYS: ` ${a} , ${b} ,, ` });
    expect(config.hashes).toHaveLength(2);
    expect(config.ignored).toBe(0);
  });

  it('counts entries that are not 64 hex characters, so a pasted raw key is noticed', () => {
    const config = readPartnerKeyConfig({ PARTNER_KEYS: `${sha256Hex(KAZI_KEY)},${KAZI_KEY},abc` });
    expect(config.hashes).toHaveLength(1);
    expect(config.ignored).toBe(2);
  });

  it('reads an empty setting as no keys', () => {
    expect(readPartnerKeyConfig({})).toEqual({ hashes: [], ignored: 0, required: false });
    expect(readPartnerKeyConfig({ REQUIRE_PARTNER_KEY: 'true' }).required).toBe(true);
    expect(readPartnerKeyConfig({ REQUIRE_PARTNER_KEY: 'yes' }).required).toBe(false); // only exactly "true"
  });

  it('recognises an issued key by its hash, and nothing else', () => {
    const hashes = readPartnerKeyConfig({ PARTNER_KEYS: `${sha256Hex(KAZI_KEY)},${sha256Hex(OTHER_KEY)}` }).hashes;
    expect(isIssuedKey(KAZI_KEY, hashes)).toBe(true);
    expect(isIssuedKey(OTHER_KEY, hashes)).toBe(true);
    expect(isIssuedKey(sha256Hex(KAZI_KEY), hashes)).toBe(false); // the hash is not the key
    expect(isIssuedKey(KAZI_KEY.toUpperCase(), hashes)).toBe(false);
    expect(isIssuedKey('', hashes)).toBe(false);
    expect(isIssuedKey(KAZI_KEY, [])).toBe(false);
  });
});

// The partner endpoints, each with a request that would otherwise succeed or answer 404.
// Every row has four entries, the last being the body or `undefined`. A shorter row would make
// Jest pass its `done` callback as the fourth argument, and the test would wait for it forever.
type PartnerCall = [label: string, method: 'get' | 'post' | 'delete', path: string, body: object | undefined];
const PARTNER_CALLS: PartnerCall[] = [
  ['GET /api/events', 'get', '/api/events?status=upcoming', undefined],
  ['GET /api/events/{eventId}', 'get', '/api/events/evt_2001', undefined],
  ['GET /api/events/{eventId}/roles', 'get', '/api/events/evt_2001/roles', undefined],
  ['POST /api/offers', 'post', '/api/offers', { roleId: 'rol_3010', workersOffered: 1 }],
  ['GET /api/offers/{offerId}', 'get', '/api/offers/ofr_9999', undefined],
  ['DELETE /api/offers/{offerId}', 'delete', '/api/offers/ofr_9999', undefined],
];

describe('with partner keys configured (R4)', () => {
  beforeEach(() => setKeys(sha256Hex(KAZI_KEY)));

  it.each(PARTNER_CALLS)('%s answers 401 { message } without a key', async (_label, method, path, body) => {
    const req = request(app())[method](path);
    const res = await (body ? req.send(body) : req);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ message: 'Send your partner key as X-API-Key' });
    expect(res.headers['www-authenticate']).toBe('ApiKey');
    expect(res.headers['content-type']).toContain('application/json');
  });

  it.each(PARTNER_CALLS)('%s answers 401 for a wrong key, an empty key, and the hash used as if it were the key', async (_label, method, path, body) => {
    for (const bad of ['wrong-key', '', ' ', OTHER_KEY, sha256Hex(KAZI_KEY), KAZI_KEY.toUpperCase(), `${KAZI_KEY}x`, 'x'.repeat(5000)]) {
      const req = request(app())[method](path).set('X-API-Key', bad);
      const res = await (body ? req.send(body) : req);
      expect(res.status).toBe(401);
    }
  });

  it.each(PARTNER_CALLS)('%s works with Kazi’s key', async (_label, method, path, body) => {
    const req = request(app())[method](path).set('X-API-Key', KAZI_KEY);
    const res = await (body ? req.send(body) : req);
    expect(res.status).not.toBe(401);
    expect([200, 201, 204, 404, 409]).toContain(res.status);
  });

  it('accepts the key with spaces around it, and the header name in any case', async () => {
    expect((await request(app()).get('/api/events/evt_2001').set('x-api-key', `  ${KAZI_KEY}  `)).status).toBe(200);
  });

  it('checks the key before looking at anything else: no 400 or 404 leaks to a stranger', async () => {
    expect((await request(app()).post('/api/offers').send('not json at all')).status).toBe(401);
    expect((await request(app()).post('/api/offers').send({ junk: true })).status).toBe(401);
    expect((await request(app()).delete('/api/offers/ofr_9999')).status).toBe(401); // not 404
    expect((await request(app()).get('/api/events')).status).toBe(401); // not 400 for the missing status
  });

  it('changes nothing for a caller without a key', async () => {
    const store = await getStore();
    const before = (await store.offers.listByEvent('evt_2006')).length;
    const res = await request(app()).post('/api/offers').send({ roleId: 'rol_3010', workersOffered: 1 });
    expect(res.status).toBe(401);
    expect(await store.offers.listByEvent('evt_2006')).toHaveLength(before);

    const offer = await store.offers.create({ role_id: 'rol_3009', event_id: 'evt_2005', workers_offered: 1, note: '' });
    expect((await request(app()).delete(`/api/offers/${offer.id}`)).status).toBe(401);
    expect(await store.offers.get(offer.id)).not.toBeNull(); // still there
  });

  it('lets Kazi do the whole job with its key: read, offer, read back, withdraw', async () => {
    const key = { 'X-API-Key': KAZI_KEY };
    const roles = await request(app()).get('/api/events/evt_2004/roles').set(key);
    expect(roles.status).toBe(200);
    const created = await request(app()).post('/api/offers').set(key).send({ roleId: roles.body[0].id, workersOffered: 2, note: 'Kazi' });
    expect(created.status).toBe(201);
    expect((await request(app()).get(`/api/offers/${created.body.id}`).set(key)).body.status).toBe('pending');
    expect((await request(app()).delete(`/api/offers/${created.body.id}`).set(key)).status).toBe(204);
  });

  it('accepts either of two issued keys, and stops accepting one once it is removed', async () => {
    setKeys(`${sha256Hex(KAZI_KEY)},${sha256Hex(OTHER_KEY)}`);
    expect((await request(app()).get('/api/events/evt_2001').set('X-API-Key', KAZI_KEY)).status).toBe(200);
    expect((await request(app()).get('/api/events/evt_2001').set('X-API-Key', OTHER_KEY)).status).toBe(200);
    setKeys(sha256Hex(OTHER_KEY)); // Kazi's key is revoked
    expect((await request(app()).get('/api/events/evt_2001').set('X-API-Key', KAZI_KEY)).status).toBe(401);
    expect((await request(app()).get('/api/events/evt_2001').set('X-API-Key', OTHER_KEY)).status).toBe(200);
  });

  it('never needs the raw key stored anywhere: the setting holds only the hash', () => {
    expect(process.env.PARTNER_KEYS).not.toContain(KAZI_KEY);
    expect(process.env.PARTNER_KEYS).toBe(sha256Hex(KAZI_KEY));
  });

  describe('the website’s organisers', () => {
    it('can read events, one event and its roles with their login instead of a key', async () => {
      const me = await newOrganiser(app());
      expect((await request(app()).get('/api/events?status=upcoming').set(me.auth)).status).toBe(200);
      expect((await request(app()).get('/api/events/evt_2001').set(me.auth)).status).toBe(200);
      expect((await request(app()).get('/api/events/evt_2001/roles').set(me.auth)).status).toBe(200);
    });

    it('cannot use a login where only Kazi’s key is accepted', async () => {
      const me = await newOrganiser(app());
      expect((await request(app()).post('/api/offers').set(me.auth).send({ roleId: 'rol_3010', workersOffered: 1 })).status).toBe(401);
      expect((await request(app()).get('/api/offers/ofr_9999').set(me.auth)).status).toBe(401);
      expect((await request(app()).delete('/api/offers/ofr_9999').set(me.auth)).status).toBe(401);
    });

    it('is refused with a login that is not valid, expired or logged out', async () => {
      const me = await newOrganiser(app());
      expect((await request(app()).get('/api/events/evt_2001').set('Authorization', `Bearer ${'a'.repeat(43)}`)).status).toBe(401);
      await request(app()).post('/api/auth/logout').set(me.auth);
      expect((await request(app()).get('/api/events/evt_2001').set(me.auth)).status).toBe(401);
    });

    it('still decides offers with their login alone: that endpoint was never a partner one', async () => {
      const me = await newOrganiser(app());
      const event = await request(app()).post('/api/events').set(me.auth).send({
        name: 'E', type: 'other', county: 'Kisumu', area: 'Milimani', venue: 'V', startsAt: inDays(50), endsAt: inDays(50, 20), expectedGuests: 10,
      });
      const role = await request(app()).post(`/api/events/${event.body.id}/roles`).set(me.auth).send({
        title: 'T', category: 'events', headcount: 2, shiftStart: inDays(50, 8), shiftEnd: inDays(50, 18), payPerShift: 1000,
      });
      const offer = await request(app()).post('/api/offers').set('X-API-Key', KAZI_KEY).send({ roleId: role.body.id, workersOffered: 1 });
      expect(offer.status).toBe(201);
      expect((await request(app()).patch(`/api/offers/${offer.body.id}`).set(me.auth).send({ status: 'accepted' })).status).toBe(200);
    });
  });

  it('does not ask the website’s own endpoints for a partner key', async () => {
    const register = await request(app()).post('/api/auth/register').send({ email: `nokey${Date.now()}@example.com`, name: 'N', password: 'long enough pw' });
    expect(register.status).toBe(201);
    expect((await request(app()).get('/api/me').set('Authorization', `Bearer ${register.body.token}`)).status).toBe(200);
    expect((await request(app()).get('/')).status).toBe(200);
    expect((await request(app()).get('/openapi.yaml')).status).toBe(200);
  });
});

describe('with no partner keys configured', () => {
  it('leaves the partner endpoints open, and warns once', async () => {
    setKeys('');
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect((await request(app()).get('/api/events/evt_2001')).status).toBe(200);
    expect((await request(app()).get('/api/events/evt_2001/roles')).status).toBe(200);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('OPEN to anyone');
  });

  it('refuses every partner call when REQUIRE_PARTNER_KEY is true and no key is set', async () => {
    setKeys('', true);
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    expect((await request(app()).get('/api/events/evt_2001')).status).toBe(401);
    expect((await request(app()).get('/api/events/evt_2001').set('X-API-Key', KAZI_KEY)).status).toBe(401);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('REQUIRE_PARTNER_KEY is true'));
  });

  it('refuses everything, rather than opening up, when PARTNER_KEYS holds only unusable entries', async () => {
    setKeys(KAZI_KEY); // the raw key pasted where its hash belongs
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    expect((await request(app()).get('/api/events/evt_2001')).status).toBe(401);
    expect((await request(app()).get('/api/events/evt_2001').set('X-API-Key', KAZI_KEY)).status).toBe(401);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('none is a 64-character SHA-256 hash'));
  });

  it('still accepts a valid key when other entries are unusable, and says how many were ignored', async () => {
    setKeys(`${sha256Hex(KAZI_KEY)},oops`);
    expect(readPartnerKeyConfig().ignored).toBe(1);
    expect((await request(app()).get('/api/events/evt_2001').set('X-API-Key', KAZI_KEY)).status).toBe(200);
  });
});
