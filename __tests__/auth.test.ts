import request from 'supertest';
import { sha256Hex } from '@/lib/auth/session';
import { getStore } from '@/lib/db';
import { useTestServer } from './helpers/server';
import { ISO_DATE, keysOf } from './helpers/shapes';

const app = useTestServer();

const account = { email: 'njeri@example.com', name: 'Njeri Kamau', password: 'correct horse battery' };
// Always send real JSON text, so a body of "hello" or null reaches the server as exactly that.
const postJson = (path: string, body: unknown) =>
  request(app()).post(path).set('Content-Type', 'application/json').send(JSON.stringify(body));
const register = (body: unknown = account) => postJson('/api/auth/register', body);
const login = (body: unknown) => postJson('/api/auth/login', body);
const me = (token?: string) => {
  const req = request(app()).get('/api/me');
  return token ? req.set('Authorization', `Bearer ${token}`) : req;
};

describe('POST /api/auth/register (O1)', () => {
  it('creates the account, logs it in and sends exactly the contract fields', async () => {
    const res = await register();
    expect(res.status).toBe(201);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(keysOf(res.body)).toEqual(['expiresAt', 'token', 'user']);
    expect(keysOf(res.body.user)).toEqual(['email', 'id', 'name']);
    expect(res.body.user).toMatchObject({ id: 'usr_1002', email: 'njeri@example.com', name: 'Njeri Kamau' });
    expect(res.body.expiresAt).toMatch(ISO_DATE);
    expect(res.body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('sends a token that works straight away, and a week of life', async () => {
    const res = await register({ ...account, email: 'week@example.com' });
    expect((await me(res.body.token)).body.email).toBe('week@example.com');
    const days = (Date.parse(res.body.expiresAt) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThanOrEqual(7);
  });

  it('never sends the password or its hash back', async () => {
    const res = await register({ ...account, email: 'secret@example.com' });
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain(account.password);
    expect(raw).not.toMatch(/scrypt|password|hash/i);
  });

  it('stores the password as a hash and the token only as a SHA-256 hash', async () => {
    const res = await register({ ...account, email: 'stored@example.com' });
    const store = await getStore();
    const user = await store.users.findByEmail('stored@example.com');
    expect(user?.password_hash).toMatch(/^scrypt\$/);
    expect(user?.password_hash).not.toContain(account.password);
    expect(await store.sessions.findByTokenHash(sha256Hex(res.body.token))).toMatchObject({ user_id: user?.id });
    expect(await store.sessions.findByTokenHash(res.body.token)).toBeNull(); // the raw token is not a key
  });

  it('trims and lower-cases the email, and trims the name', async () => {
    const res = await register({ email: '  Wanjiru.M@Example.COM ', name: '  Wanjiru M  ', password: 'long enough pw' });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ email: 'wanjiru.m@example.com', name: 'Wanjiru M' });
  });

  it('keeps spaces in the password: it works only exactly as typed', async () => {
    await register({ email: 'spaces@example.com', name: 'S', password: '  twelve spaces  ' });
    expect((await login({ email: 'spaces@example.com', password: '  twelve spaces  ' })).status).toBe(200);
    expect((await login({ email: 'spaces@example.com', password: 'twelve spaces' })).status).toBe(401);
  });

  it('answers 409 for an email that is taken, in any letter case, and creates nothing', async () => {
    await register({ ...account, email: 'taken@example.com' });
    for (const email of ['taken@example.com', 'TAKEN@Example.com']) {
      const res = await register({ email, name: 'Someone Else', password: 'another password' });
      expect(res.status).toBe(409);
      expect(keysOf(res.body)).toEqual(['message']);
    }
    // the first password still works, the second never became one
    expect((await login({ email: 'taken@example.com', password: account.password })).status).toBe(200);
    expect((await login({ email: 'taken@example.com', password: 'another password' })).status).toBe(401);
  });

  it('answers 409 to two registrations arriving together, and one account results', async () => {
    const body = { email: 'race@example.com', name: 'Race', password: 'racing password' };
    const results = await Promise.all([register(body), register(body)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
  });

  it.each([
    ['no body', undefined, 'Request body is required'],
    ['an array', [], 'must be a JSON object'],
    ['a string', 'hello', 'must be a JSON object'],
    ['null', null, 'must be a JSON object'],
    ['a missing email', { name: 'N', password: 'long enough pw' }, 'email is required'],
    ['an email without @', { ...account, email: 'njeri.example.com' }, 'valid email'],
    ['an email without a domain dot', { ...account, email: 'njeri@localhost' }, 'valid email'],
    ['an email with spaces', { ...account, email: 'nje ri@example.com' }, 'valid email'],
    ['a number for the email', { ...account, email: 42 }, 'email must be text'],
    ['an email over 254 characters', { ...account, email: `${'a'.repeat(250)}@example.com` }, 'at most 254'],
    ['a missing name', { email: 'a@example.com', password: 'long enough pw' }, 'name is required'],
    ['a blank name', { ...account, name: '   ' }, 'name cannot be empty'],
    ['a name over 100 characters', { ...account, name: 'x'.repeat(101) }, 'at most 100'],
    ['a missing password', { email: 'a@example.com', name: 'N' }, 'password is required'],
    ['a password under 8 characters', { ...account, password: 'short' }, 'at least 8'],
    ['a password over 128 characters', { ...account, password: 'x'.repeat(129) }, 'at most 128'],
    ['a number for the password', { ...account, password: 12345678 }, 'password must be text'],
    ['an unknown field', { ...account, isAdmin: true }, 'Unknown field "isAdmin"'],
  ])('answers 400 { message } for %s', async (_label, body, text) => {
    const res = body === undefined ? await request(app()).post('/api/auth/register') : await register(body);
    expect(res.status).toBe(400);
    expect(keysOf(res.body)).toEqual(['message']);
    expect(res.body.message).toContain(text);
  });

  it('answers 400 for malformed JSON and 413 for a body over 20 KB, creating nothing', async () => {
    const bad = await request(app()).post('/api/auth/register').set('Content-Type', 'application/json').send('{"email":');
    expect(bad.status).toBe(400);
    const big = await register({ ...account, email: 'big@example.com', name: 'x'.repeat(25_000) });
    expect(big.status).toBe(413);
    expect((await login({ email: 'big@example.com', password: account.password })).status).toBe(401);
  });
});

describe('POST /api/auth/login (O1)', () => {
  beforeAll(async () => {
    await register({ email: 'login@example.com', name: 'Login Person', password: 'my login password' });
  });

  it('logs in and sends exactly the contract fields', async () => {
    const res = await login({ email: 'login@example.com', password: 'my login password' });
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(keysOf(res.body)).toEqual(['expiresAt', 'token', 'user']);
    expect(res.body.user.email).toBe('login@example.com');
    expect((await me(res.body.token)).status).toBe(200);
  });

  it('matches the email ignoring letter case and surrounding spaces', async () => {
    const res = await login({ email: '  LOGIN@Example.com ', password: 'my login password' });
    expect(res.status).toBe(200);
  });

  it('gives each login its own token', async () => {
    const a = await login({ email: 'login@example.com', password: 'my login password' });
    const b = await login({ email: 'login@example.com', password: 'my login password' });
    expect(a.body.token).not.toBe(b.body.token);
  });

  it('answers 401 with the same message for a wrong password and an unknown email', async () => {
    const wrong = await login({ email: 'login@example.com', password: 'not my password' });
    const unknown = await login({ email: 'nobody@example.com', password: 'my login password' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(unknown.body).toEqual(wrong.body);
    expect(wrong.body).toEqual({ message: 'Email or password is incorrect' });
  });

  it('cannot log into the sample organiser account, whatever the password', async () => {
    for (const password of ['seed-account-cannot-log-in', 'password', '']) {
      const res = await login({ email: 'organiser@sherehe.example', password });
      expect(res.status).toBe(password === '' ? 400 : 401);
    }
  });

  it.each([
    ['no body', undefined, 'Request body is required'],
    ['a missing email', { password: 'x' }, 'email is required'],
    ['an invalid email', { email: 'nope', password: 'x' }, 'valid email'],
    ['a missing password', { email: 'login@example.com' }, 'password is required'],
    ['an empty password', { email: 'login@example.com', password: '' }, 'password cannot be empty'],
    ['a non-text password', { email: 'login@example.com', password: ['x'] }, 'password must be text'],
    ['an unknown field', { email: 'login@example.com', password: 'x', remember: true }, 'Unknown field "remember"'],
  ])('answers 400 { message } for %s', async (_label, body, text) => {
    const res = body === undefined ? await request(app()).post('/api/auth/login') : await login(body);
    expect(res.status).toBe(400);
    expect(res.body.message).toContain(text);
  });
});

describe('GET /api/me (O1)', () => {
  it('returns the logged-in organiser with exactly the contract fields', async () => {
    const { body } = await register({ email: 'me@example.com', name: 'Me Myself', password: 'my own password' });
    const res = await me(body.token);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: body.user.id, email: 'me@example.com', name: 'Me Myself' });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it.each([
    ['no Authorization header', undefined],
    ['a token that was never issued', 'Bearer ' + 'a'.repeat(43)],
    ['the wrong scheme', 'Basic dXNlcjpwYXNz'],
    ['a bare token', 'abc123'],
    ['an empty bearer', 'Bearer '],
    ['a very long token', 'Bearer ' + 'a'.repeat(5000)],
  ])('answers 401 { message } with %s', async (_label, header) => {
    const req = request(app()).get('/api/me');
    const res = await (header ? req.set('Authorization', header) : req);
    expect(res.status).toBe(401);
    expect(keysOf(res.body)).toEqual(['message']);
    expect(res.headers['www-authenticate']).toBe('Bearer');
  });

  it('accepts the scheme in any letter case', async () => {
    const { body } = await register({ email: 'case@example.com', name: 'Case', password: 'case insensitive' });
    const res = await request(app()).get('/api/me').set('Authorization', `bearer ${body.token}`);
    expect(res.status).toBe(200);
  });

  it('refuses an expired login and forgets it', async () => {
    const { body } = await register({ email: 'expired@example.com', name: 'Old', password: 'expiring password' });
    const store = await getStore();
    await store.sessions.delete(sha256Hex(body.token));
    await store.sessions.create({
      token_hash: sha256Hex(body.token), user_id: body.user.id, expires_at: new Date(Date.now() - 1000),
    });
    expect((await me(body.token)).status).toBe(401);
    expect(await store.sessions.findByTokenHash(sha256Hex(body.token))).toBeNull();
  });
});

describe('POST /api/auth/logout (O1)', () => {
  it('answers 204 with no body and the token stops working', async () => {
    const { body } = await register({ email: 'out@example.com', name: 'Out', password: 'logging out now' });
    const res = await request(app()).post('/api/auth/logout').set('Authorization', `Bearer ${body.token}`);
    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    expect((await me(body.token)).status).toBe(401);
  });

  it('only ends the login it was sent with', async () => {
    await register({ email: 'two@example.com', name: 'Two', password: 'two logins here' });
    const a = await login({ email: 'two@example.com', password: 'two logins here' });
    const b = await login({ email: 'two@example.com', password: 'two logins here' });
    await request(app()).post('/api/auth/logout').set('Authorization', `Bearer ${a.body.token}`);
    expect((await me(a.body.token)).status).toBe(401);
    expect((await me(b.body.token)).status).toBe(200);
  });

  it('answers 401 without a valid token, including when logging out twice', async () => {
    expect((await request(app()).post('/api/auth/logout')).status).toBe(401);
    const { body } = await register({ email: 'twice@example.com', name: 'Twice', password: 'logging out twice' });
    const out = () => request(app()).post('/api/auth/logout').set('Authorization', `Bearer ${body.token}`);
    expect((await out()).status).toBe(204);
    expect((await out()).status).toBe(401);
  });
});
