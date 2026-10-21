/** @jest-environment jsdom */
import { AUTH_CHANGED, TOKEN_KEY, api, getToken, setToken } from '@/components/api';
import { installFetch, rejectAll } from './helpers';

beforeEach(() => {
  window.localStorage.clear();
});

describe('the saved login token', () => {
  it('is kept in this browser and announced when it changes', () => {
    const changed = jest.fn();
    window.addEventListener(AUTH_CHANGED, changed);
    expect(getToken()).toBeNull();
    setToken('abc');
    expect(getToken()).toBe('abc');
    expect(window.localStorage.getItem(TOKEN_KEY)).toBe('abc');
    setToken(null);
    expect(getToken()).toBeNull();
    expect(changed).toHaveBeenCalledTimes(2);
    window.removeEventListener(AUTH_CHANGED, changed);
  });

  it('does not break the site when the browser blocks storage', () => {
    const blocked = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(getToken()).toBeNull();
    const set = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => setToken('abc')).not.toThrow();
    blocked.mockRestore();
    set.mockRestore();
  });
});

describe('api()', () => {
  it('sends the saved token as a Bearer token, unless asked not to', async () => {
    setToken('tok');
    const { calls } = installFetch({ 'GET /api/me': () => ({ body: { id: 'usr_1' } }), 'POST /api/auth/login': () => ({ body: {} }) });
    await api('/api/me');
    await api('/api/auth/login', { method: 'POST', body: {}, auth: false });
    expect(calls[0].authorization).toBe('Bearer tok');
    expect(calls[1].authorization).toBeNull();
  });

  it('sends no Authorization header when nobody is logged in', async () => {
    const { calls } = installFetch({ 'GET /api/events': () => ({ body: [] }) });
    await api('/api/events');
    expect(calls[0].authorization).toBeNull();
  });

  it('returns the data of a successful call, including an empty 204', async () => {
    installFetch({ 'GET /api/events': () => ({ body: [{ id: 'evt_1' }] }), 'DELETE /api/x': () => ({ status: 204 }) });
    expect(await api('/api/events')).toEqual({ ok: true, status: 200, data: [{ id: 'evt_1' }] });
    expect(await api('/api/x', { method: 'DELETE' })).toEqual({ ok: true, status: 204, data: undefined });
  });

  it('sends a body as JSON', async () => {
    const { calls } = installFetch({ 'POST /api/offers': () => ({ status: 201, body: {} }) });
    await api('/api/offers', { method: 'POST', body: { roleId: 'rol_1', workersOffered: 2 } });
    expect(calls[0]).toMatchObject({ method: 'POST', body: { roleId: 'rol_1', workersOffered: 2 } });
  });

  it('shows the API’s own plain-English message for a failure', async () => {
    installFetch({ 'POST /api/events': () => ({ status: 400, body: { message: 'startsAt must be in the future' } }) });
    expect(await api('/api/events', { method: 'POST', body: {} })).toEqual({ ok: false, status: 400, message: 'startsAt must be in the future' });
  });

  it.each([[400], [401], [403], [404], [409], [502], [500]])('has a readable fallback when a %s has no message', async (status) => {
    installFetch({ 'GET /api/x': () => ({ status }) });
    const res = await api('/api/x');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message.length).toBeGreaterThan(10);
  });

  it('copes with a failure whose body is not JSON', async () => {
    (globalThis as { fetch: unknown }).fetch = jest.fn(async () => ({ ok: false, status: 502, text: async () => '<html>bad gateway</html>' }));
    const res = await api('/api/x');
    expect(res).toMatchObject({ ok: false, status: 502 });
  });

  it('says so, in plain words, when the network is down', async () => {
    rejectAll();
    expect(await api('/api/events')).toEqual({ ok: false, status: 0, message: 'Could not reach Sherehe. Check your connection and try again.' });
  });

  it('forgets a token the server no longer accepts, so the page asks for a login again', async () => {
    setToken('stale');
    const changed = jest.fn();
    window.addEventListener(AUTH_CHANGED, changed);
    installFetch({ 'GET /api/me': () => ({ status: 401, body: { message: 'Your login is not valid or has expired. Log in again.' } }) });
    const res = await api('/api/me');
    expect(res).toMatchObject({ ok: false, status: 401 });
    expect(getToken()).toBeNull();
    expect(changed).toHaveBeenCalled();
    window.removeEventListener(AUTH_CHANGED, changed);
  });

  it('keeps a token when a call without one is refused', async () => {
    installFetch({ 'POST /api/auth/login': () => ({ status: 401, body: { message: 'Email or password is incorrect' } }) });
    setToken('keep');
    await api('/api/auth/login', { method: 'POST', body: {}, auth: false });
    expect(getToken()).toBe('keep');
  });
});
