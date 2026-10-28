import request from 'supertest';
import { sha256Hex } from '@/lib/auth/hash';
import { describePartnerKeys, findIssuedKey, readPartnerKeyConfig } from '@/lib/auth/partnerKey';
import { getStore } from '@/lib/db';
import { newOrganiser } from './helpers/auth';
import { inDays } from './helpers/dates';
import { useTestServer } from './helpers/server';

const app = useTestServer();

const KAZI_KEY = 'shk_kazi-connect-test-key-0123456789';
const OTHER_KEY = 'shk_a-second-system-test-key-abcdef';
const WARNED = Symbol.for('sherehe.partnerKeyWarned');

// `open` is the test-only ALLOW_OPEN_PARTNER_API switch. It is off here: this file is about what happens
// with and without keys. The rest of the suite runs with it on (setupEnv.ts).
const setKeys = (value: string, open = false) => {
  process.env.PARTNER_KEYS = value;
  if (open) process.env.ALLOW_OPEN_PARTNER_API = 'true';
  else delete process.env.ALLOW_OPEN_PARTNER_API;
  delete (globalThis as { [k: symbol]: unknown })[WARNED];
};
afterEach(() => {
  process.env.PARTNER_KEYS = '';
  process.env.ALLOW_OPEN_PARTNER_API = 'true';
  jest.restoreAllMocks();
});

describe('reading PARTNER_KEYS', () => {
  const a = sha256Hex(KAZI_KEY);
  const b = sha256Hex(OTHER_KEY);

  it('takes comma-separated name:hash entries, ignoring spaces and letter case', () => {
    const config = readPartnerKeyConfig({ PARTNER_KEYS: ` Kazi:${a} , other : ${b.toUpperCase()} ,, ` });
    expect(config.keys.map((k) => k.name)).toEqual(['kazi', 'other']);
    expect(config.ignored).toBe(0);
  });

  it('lets several entries share a name, which is how a key is rotated', () => {
    const config = readPartnerKeyConfig({ PARTNER_KEYS: `kazi:${a},kazi:${b}` });
    expect(config.keys.map((k) => k.name)).toEqual(['kazi', 'kazi']);
  });

  it('counts entries that are not name:hash, so a pasted raw key or an unnamed hash is noticed', () => {
    const config = readPartnerKeyConfig({ PARTNER_KEYS: `kazi:${a},${KAZI_KEY},${b},abc,:${a},kazi:abc,9bad:${a},kazi:${a}zz` });
    expect(config.keys).toHaveLength(1);
    expect(config.ignored).toBe(7);
  });

  it('reads an empty setting as no keys, closed', () => {
    expect(readPartnerKeyConfig({})).toEqual({ keys: [], ignored: 0, open: false, openRefused: false });
  });

  it('opens the partner API only when asked for, and never in production', () => {
    expect(readPartnerKeyConfig({ ALLOW_OPEN_PARTNER_API: 'true' }).open).toBe(true);
    expect(readPartnerKeyConfig({ ALLOW_OPEN_PARTNER_API: 'yes' }).open).toBe(false); // only exactly "true"
    expect(readPartnerKeyConfig({ ALLOW_OPEN_PARTNER_API: 'true', NODE_ENV: 'test' }).open).toBe(true);
    expect(readPartnerKeyConfig({ ALLOW_OPEN_PARTNER_API: 'true', NODE_ENV: 'production' })).toMatchObject({ open: false, openRefused: true });
    expect(readPartnerKeyConfig({ NODE_ENV: 'production' }).open).toBe(false);
  });

  it('recognises an issued key by its hash, and returns the consumer it belongs to', () => {
    const { keys } = readPartnerKeyConfig({ PARTNER_KEYS: `kazi:${a},other:${b}` });
    expect(findIssuedKey(KAZI_KEY, keys)).toBe('kazi');
    expect(findIssuedKey(OTHER_KEY, keys)).toBe('other');
    expect(findIssuedKey(sha256Hex(KAZI_KEY), keys)).toBeNull(); // the hash is not the key
    expect(findIssuedKey(KAZI_KEY.toUpperCase(), keys)).toBeNull();
    expect(findIssuedKey('', keys)).toBeNull();
    expect(findIssuedKey(KAZI_KEY, [])).toBeNull();
  });

  it('describes what is loaded as a count and names, never a key or a hash', () => {
    const open = describePartnerKeys(readPartnerKeyConfig({ PARTNER_KEYS: `kazi:${a},kazi:${b},other:${b}` }));
    expect(open).toEqual({ level: 'log', text: 'Partner keys loaded: 3 (kazi, other).' });
    const none = describePartnerKeys(readPartnerKeyConfig({}));
    expect(none.level).toBe('warn');
    expect(none.text).toContain('Partner keys loaded: 0');
    expect(none.text).toContain('refused');
    for (const { text } of [open, none]) expect(text).not.toMatch(/[0-9a-f]{64}/);
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
  beforeEach(() => setKeys(`kazi:${sha256Hex(KAZI_KEY)}`));

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

    const offer = await store.offers.create({ role_id: 'rol_3009', event_id: 'evt_2005', workers_offered: 1, note: '', partner: 'kazi' });
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
    setKeys(`kazi:${sha256Hex(KAZI_KEY)},other:${sha256Hex(OTHER_KEY)}`);
    expect((await request(app()).get('/api/events/evt_2001').set('X-API-Key', KAZI_KEY)).status).toBe(200);
    expect((await request(app()).get('/api/events/evt_2001').set('X-API-Key', OTHER_KEY)).status).toBe(200);
    setKeys(`other:${sha256Hex(OTHER_KEY)}`); // Kazi's key is revoked
    expect((await request(app()).get('/api/events/evt_2001').set('X-API-Key', KAZI_KEY)).status).toBe(401);
    expect((await request(app()).get('/api/events/evt_2001').set('X-API-Key', OTHER_KEY)).status).toBe(200);
  });

  it('never needs the raw key stored anywhere: the setting holds only the hash', () => {
    expect(process.env.PARTNER_KEYS).not.toContain(KAZI_KEY);
    expect(process.env.PARTNER_KEYS).toBe(`kazi:${sha256Hex(KAZI_KEY)}`);
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

describe('offers belong to the consumer that made them', () => {
  const KAZI = { 'X-API-Key': KAZI_KEY };
  const OTHER = { 'X-API-Key': OTHER_KEY };
  const makeOffer = async (roleId: string, headers = KAZI) => request(app()).post('/api/offers').set(headers).send({ roleId, workersOffered: 1 });

  beforeEach(() => setKeys(`kazi:${sha256Hex(KAZI_KEY)},other:${sha256Hex(OTHER_KEY)}`));

  // A role of its own on a new event, so no earlier test's offers are in the way.
  let day = 52;
  const freshRole = async (me: Awaited<ReturnType<typeof newOrganiser>>) => {
    day += 1;
    const event = await request(app()).post('/api/events').set(me.auth).send({
      name: 'E', type: 'other', county: 'Kisumu', area: 'Milimani', venue: 'V', startsAt: inDays(day), endsAt: inDays(day, 20), expectedGuests: 10,
    });
    const role = await request(app()).post(`/api/events/${event.body.id}/roles`).set(me.auth).send({
      title: 'T', category: 'events', headcount: 2, shiftStart: inDays(day, 8), shiftEnd: inDays(day, 18), payPerShift: 1000,
    });
    return { eventId: event.body.id as string, roleId: role.body.id as string };
  };

  it('answers 404, exactly like an unknown offer, to a different consumer reading or withdrawing it', async () => {
    const { roleId } = await freshRole(await newOrganiser(app()));
    const offer = await makeOffer(roleId);
    expect(offer.status).toBe(201);
    const unknown = await request(app()).get('/api/offers/ofr_99999').set(OTHER);
    const foreignRead = await request(app()).get(`/api/offers/${offer.body.id}`).set(OTHER);
    expect(foreignRead.status).toBe(404);
    expect(foreignRead.body).toEqual({ message: `Offer ${offer.body.id} not found` });
    expect(unknown.body).toEqual({ message: 'Offer ofr_99999 not found' }); // same wording, so nothing is given away
    const foreignWithdraw = await request(app()).delete(`/api/offers/${offer.body.id}`).set(OTHER);
    expect(foreignWithdraw.status).toBe(404);
    const store = await getStore();
    expect((await store.offers.get(offer.body.id))?.status).toBe('pending'); // untouched
    expect((await request(app()).get(`/api/offers/${offer.body.id}`).set(KAZI)).status).toBe(200);
    expect((await request(app()).delete(`/api/offers/${offer.body.id}`).set(KAZI)).status).toBe(204);
  });

  it('files the offer under the key’s name, which the API never shows', async () => {
    const { roleId } = await freshRole(await newOrganiser(app()));
    const offer = await makeOffer(roleId, OTHER);
    expect(offer.status).toBe(201);
    expect(Object.keys(offer.body)).not.toContain('partner');
    const store = await getStore();
    expect((await store.offers.get(offer.body.id))?.partner).toBe('other');
  });

  it('keeps one pending offer per role, whoever made it', async () => {
    const { roleId } = await freshRole(await newOrganiser(app()));
    expect((await makeOffer(roleId)).status).toBe(201);
    expect((await makeOffer(roleId, OTHER)).status).toBe(409);
  });

  it('survives a key rotation: the old and the new key under one name see the same offers', async () => {
    const { roleId } = await freshRole(await newOrganiser(app()));
    const offer = await makeOffer(roleId);
    setKeys(`kazi:${sha256Hex(KAZI_KEY)},kazi:${sha256Hex(OTHER_KEY)}`); // the overlap: both are Kazi
    expect((await request(app()).get(`/api/offers/${offer.body.id}`).set(OTHER)).status).toBe(200);
    setKeys(`kazi:${sha256Hex(OTHER_KEY)}`); // the old key is retired
    expect((await request(app()).get(`/api/offers/${offer.body.id}`).set(OTHER)).status).toBe(200);
    expect((await request(app()).get(`/api/offers/${offer.body.id}`).set(KAZI)).status).toBe(401);
  });

  it('lets the organiser still see and decide the offer, whoever made it', async () => {
    const me = await newOrganiser(app());
    const { eventId, roleId } = await freshRole(me);
    const offer = await makeOffer(roleId, OTHER);
    const listed = await request(app()).get(`/api/events/${eventId}/offers`).set(me.auth);
    expect(listed.body.map((o: { id: string }) => o.id)).toEqual([offer.body.id]);
    expect(JSON.stringify(listed.body)).not.toContain('other');
    expect((await request(app()).patch(`/api/offers/${offer.body.id}`).set(me.auth).send({ status: 'accepted' })).status).toBe(200);
  });
});

describe('with no partner keys configured: closed, in every environment', () => {
  it.each(PARTNER_CALLS)('%s answers 401, with or without a key header', async (_label, method, path, body) => {
    setKeys('');
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    for (const headers of [{}, { 'X-API-Key': KAZI_KEY }]) {
      const req = request(app())[method](path).set(headers);
      const res = await (body ? req.send(body) : req);
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ message: 'Send your partner key as X-API-Key' });
    }
  });

  it('says so once in the log, as a count', async () => {
    setKeys('');
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await request(app()).get('/api/events/evt_2001');
    await request(app()).get('/api/events/evt_2001');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('Partner keys loaded: 0');
  });

  it('still lets a logged-in organiser read what the website needs', async () => {
    setKeys('');
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const me = await newOrganiser(app());
    expect((await request(app()).get('/api/events/evt_2001').set(me.auth)).status).toBe(200);
  });

  it('is open only when ALLOW_OPEN_PARTNER_API=true is set outside production, and warns about it once', async () => {
    setKeys('', true);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect((await request(app()).get('/api/events/evt_2001')).status).toBe(200);
    expect((await request(app()).get('/api/events/evt_2001/roles')).status).toBe(200);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('OPEN to anyone');
  });

  it('is not opened by that switch once any key is set up', async () => {
    setKeys(`kazi:${sha256Hex(KAZI_KEY)}`, true);
    expect((await request(app()).get('/api/events/evt_2001')).status).toBe(401);
    expect((await request(app()).get('/api/events/evt_2001').set('X-API-Key', KAZI_KEY)).status).toBe(200);
  });

  it('refuses everything, rather than opening up, when PARTNER_KEYS holds only unusable entries', async () => {
    for (const bad of [KAZI_KEY, sha256Hex(KAZI_KEY)]) { // a pasted raw key, and a hash with no name
      setKeys(bad, true);
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      expect((await request(app()).get('/api/events/evt_2001')).status).toBe(401);
      expect((await request(app()).get('/api/events/evt_2001').set('X-API-Key', KAZI_KEY)).status).toBe(401);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('not name:hash'));
      warn.mockRestore();
    }
  });

  it('still accepts a valid key when other entries are unusable, and says how many were ignored', async () => {
    setKeys(`kazi:${sha256Hex(KAZI_KEY)},oops`);
    expect(readPartnerKeyConfig().ignored).toBe(1);
    expect((await request(app()).get('/api/events/evt_2001').set('X-API-Key', KAZI_KEY)).status).toBe(200);
  });
});
