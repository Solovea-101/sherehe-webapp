import request from 'supertest';
import { getStore } from '@/lib/db';
import { newOrganiser } from './helpers/auth';
import { useTestServer } from './helpers/server';
import { ISO_DATE, keysOf } from './helpers/shapes';
import { useUjuziStub } from './helpers/ujuziWorld';

const app = useTestServer();
const ujuzi = useUjuziStub();

const CHECK_KEYS = ['certificateNo', 'checkedAt', 'courseTitle', 'holder', 'id', 'issuedOn', 'level', 'valid'].sort();
const check = (auth: { Authorization: string }, body: unknown) =>
  request(app()).post('/api/certificate-checks').set(auth).set('Content-Type', 'application/json').send(JSON.stringify(body));

describe('POST /api/certificate-checks (O5, S2)', () => {
  it('checks a certificate with Ujuzi and records the check', async () => {
    const me = await newOrganiser(app());
    const res = await check(me.auth, { certificateNo: 'UJZ-2026-00123' });
    expect(res.status).toBe(201);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(keysOf(res.body)).toEqual(CHECK_KEYS);
    expect(res.body).toEqual({
      id: expect.stringMatching(/^chk_\d+$/), certificateNo: 'UJZ-2026-00123', valid: true, courseTitle: 'Food hygiene and event service',
      level: 'short-course', issuedOn: '2026-08-14', holder: 'Achieng O.', checkedAt: expect.stringMatching(ISO_DATE),
    });
    const store = await getStore();
    expect(await store.certificateChecks.listByOrganiser(me.id)).toEqual([expect.objectContaining({ certificate_no: 'UJZ-2026-00123', valid: true })]);
  });

  it('records a revoked certificate as a real result with valid false', async () => {
    const me = await newOrganiser(app());
    const res = await check(me.auth, { certificateNo: 'UJZ-2026-00124' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ valid: false, holder: 'Brian K.' });
  });

  it('accepts the number in any letter case and with spaces around it', async () => {
    const me = await newOrganiser(app());
    const res = await check(me.auth, { certificateNo: '  ujz-2026-00123 ' });
    expect(res.status).toBe(201);
    expect(res.body.certificateNo).toBe('UJZ-2026-00123');
    expect(ujuzi().calls[0].path).toBe('/api/certificates/UJZ-2026-00123');
  });

  it('asks Ujuzi every time, so a revocation shows at once', async () => {
    const me = await newOrganiser(app());
    await check(me.auth, { certificateNo: 'UJZ-2026-00123' });
    await check(me.auth, { certificateNo: 'UJZ-2026-00123' });
    expect(ujuzi().calls).toHaveLength(2);
    const store = await getStore();
    expect(await store.certificateChecks.listByOrganiser(me.id)).toHaveLength(2); // each check is its own record
  });

  it('answers 404 { message } for a number Ujuzi does not know, and records nothing', async () => {
    const me = await newOrganiser(app());
    const res = await check(me.auth, { certificateNo: 'UJZ-2026-99999' });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Certificate UJZ-2026-99999 not found' });
    const store = await getStore();
    expect(await store.certificateChecks.listByOrganiser(me.id)).toEqual([]);
  });

  it('answers 401 without a login, without calling Ujuzi', async () => {
    const res = await request(app()).post('/api/certificate-checks').send({ certificateNo: 'UJZ-2026-00123' });
    expect(res.status).toBe(401);
    expect(ujuzi().calls).toHaveLength(0);
  });

  it.each([
    ['no number', {}, 'certificateNo is required'],
    ['a blank number', { certificateNo: ' ' }, 'certificateNo cannot be empty'],
    ['a number that is not text', { certificateNo: 12345 }, 'certificateNo must be text'],
    ['the wrong prefix', { certificateNo: 'ABC-2026-00123' }, 'certificateNo must look like UJZ-2026-00123'],
    ['too few digits', { certificateNo: 'UJZ-2026-123' }, 'certificateNo must look like'],
    ['a path trick', { certificateNo: 'UJZ-2026-00123/../bookings' }, 'certificateNo must look like'],
    ['an extra field', { certificateNo: 'UJZ-2026-00123', valid: true }, 'Unknown field "valid"'],
    ['an array', [], 'must be a JSON object'],
  ])('answers 400 { message } for %s, without calling Ujuzi or recording anything', async (_label, body, text) => {
    const me = await newOrganiser(app());
    const res = await check(me.auth, body);
    expect(res.status).toBe(400);
    expect(res.body.message).toContain(text);
    expect(ujuzi().calls).toHaveLength(0);
    const store = await getStore();
    expect(await store.certificateChecks.listByOrganiser(me.id)).toEqual([]);
  });

  it('answers our own 502 when Ujuzi is down, and records nothing', async () => {
    const me = await newOrganiser(app());
    ujuzi().mode = 'down';
    const res = await check(me.auth, { certificateNo: 'UJZ-2026-00123' });
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ message: 'Ujuzi is not responding right now. Try again in a minute.' });
    const store = await getStore();
    expect(await store.certificateChecks.listByOrganiser(me.id)).toEqual([]);
  });
});
