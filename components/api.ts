// How the website talks to Sherehe: always through our own /api with fetch, never the database or
// Ujuzi directly. The login token lives in this browser's localStorage and is sent as a Bearer token.

export type ApiResult<T> = { ok: true; status: number; data: T } | { ok: false; status: number; message: string };

export const TOKEN_KEY = 'sherehe.token';
export const AUTH_CHANGED = 'sherehe:auth-changed';

function store(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null; // blocked storage (private window, strict settings): the site still works, just without staying logged in
  }
}

export function getToken(): string | null {
  try {
    return store()?.getItem(TOKEN_KEY) ?? null;
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) store()?.setItem(TOKEN_KEY, token);
    else store()?.removeItem(TOKEN_KEY);
  } catch {
    // nothing to do: see store()
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(AUTH_CHANGED));
}

const FALLBACK: { [status: number]: string } = {
  400: 'That request was not accepted. Check what you entered.',
  401: 'Please log in to continue.',
  403: 'You are not allowed to do that.',
  404: 'We could not find that.',
  409: 'That is not possible in its current state.',
  502: 'A partner service is not responding right now. Try again in a minute.',
};

/**
 * Calls an endpoint and returns either the data or a message fit to show a person. Every Sherehe
 * error already carries a plain-English `message`, so it is shown as it is.
 */
export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown; auth?: boolean } = {},
): Promise<ApiResult<T>> {
  const token = init.auth === false ? null : getToken();
  const headers: { [name: string]: string } = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(path, { method: init.method ?? 'GET', headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
  } catch {
    return { ok: false, status: 0, message: 'Could not reach Sherehe. Check your connection and try again.' };
  }

  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }

  if (res.ok) return { ok: true, status: res.status, data: body as T };
  // A rejected login means the saved token is no good any more: forget it so the page asks again.
  if (res.status === 401 && token) setToken(null);
  const message =
    typeof body === 'object' && body !== null && typeof (body as { message?: unknown }).message === 'string'
      ? (body as { message: string }).message
      : (FALLBACK[res.status] ?? 'Something went wrong. Please try again.');
  return { ok: false, status: res.status, message };
}
