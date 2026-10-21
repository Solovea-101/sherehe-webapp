// Shared by the website's component tests. Pages talk to /api with fetch, so the tests replace
// fetch with a small fake that answers from a table and records what was asked.

export interface Call {
  method: string;
  path: string; // path and query, as requested
  body: unknown;
  authorization: string | null;
}

type Responder = (call: Call) => { status?: number; body?: unknown };

/**
 * Installs a fake fetch. `routes` maps "METHOD /path" (with or without the query string) to an
 * answer. A request nobody planned for throws, so a test cannot pass by accident on a stray call.
 */
export function installFetch(routes: { [route: string]: Responder }): { calls: Call[] } {
  const calls: Call[] = [];
  const fake = async (input: unknown, init?: { method?: string; headers?: { [k: string]: string }; body?: string }) => {
    const path = String(input);
    const method = init?.method ?? 'GET';
    const call: Call = {
      method,
      path,
      body: init?.body ? JSON.parse(init.body) : undefined,
      authorization: init?.headers?.Authorization ?? null,
    };
    calls.push(call);
    const responder = routes[`${method} ${path}`] ?? routes[`${method} ${path.split('?')[0]}`];
    if (!responder) throw new Error(`Unplanned request in a test: ${method} ${path}`);
    const { status = 200, body } = responder(call);
    const text = body === undefined ? '' : JSON.stringify(body);
    return { ok: status >= 200 && status < 300, status, text: async () => text };
  };
  (globalThis as { fetch: unknown }).fetch = jest.fn(fake);
  return { calls };
}

export const rejectAll = () => {
  (globalThis as { fetch: unknown }).fetch = jest.fn(async () => {
    throw new TypeError('network down');
  });
};

export const sampleEvent = {
  id: 'evt_2001', name: 'Wanjiku and Otieno wedding', type: 'wedding', county: 'Nairobi', area: 'Westlands',
  venue: 'Sarit Expo Centre', startsAt: '2026-12-05T14:00:00Z', endsAt: '2026-12-05T22:00:00Z',
  expectedGuests: 300, status: 'upcoming',
} as const;

export const sampleRole = {
  id: 'rol_3001', eventId: 'evt_2001', title: 'Waiters', category: 'catering', headcount: 6, filled: 2,
  shiftStart: '2026-12-05T13:00:00Z', shiftEnd: '2026-12-05T23:00:00Z', payPerShift: 1500,
} as const;

export const sampleUser = { id: 'usr_1002', email: 'njeri@example.com', name: 'Njeri Kamau' } as const;
