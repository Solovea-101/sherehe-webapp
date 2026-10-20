import { MAX_BODY_BYTES, fail, guard, json, noContent, notFound, readJson } from '@/lib/http';

const post = (body: BodyInit | null, headers: Record<string, string> = {}) =>
  new Request('http://localhost/api/offers', { method: 'POST', body, headers });

describe('response helpers', () => {
  it('json sets the status, the JSON body and any extra headers', async () => {
    const res = json(201, { id: 'ofr_4001' }, { Location: '/api/offers/ofr_4001' });
    expect(res.status).toBe(201);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('location')).toBe('/api/offers/ofr_4001');
    expect(await res.json()).toEqual({ id: 'ofr_4001' });
  });

  it('fail answers { message } with the given status', async () => {
    const res = fail(404, 'Event evt_9999 not found');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ message: 'Event evt_9999 not found' });
  });

  it('noContent answers 204 with no body', async () => {
    const res = noContent();
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
  });
});

describe('notFound', () => {
  it('names the thing and its id', async () => {
    const res = notFound('Event', 'evt_9999');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ message: 'Event evt_9999 not found' });
  });

  it('shortens a very long id', async () => {
    const body = await notFound('Offer', 'x'.repeat(5000)).json();
    expect(body.message).toBe(`Offer ${'x'.repeat(50)}... not found`);
  });
});

describe('guard', () => {
  afterEach(() => jest.restoreAllMocks());

  it('passes the handler’s response through untouched', async () => {
    const res = await guard(async () => json(200, { ok: true }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('turns a thrown error into 500 { message } without leaking the cause', async () => {
    const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await guard(async () => {
      throw new Error('password=hunter2 connection refused');
    });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(Object.keys(body)).toEqual(['message']);
    expect(JSON.stringify(body)).not.toContain('hunter2');
    expect(log).toHaveBeenCalled(); // the detail goes to the server log instead
  });
});

describe('readJson', () => {
  it('parses a JSON body', async () => {
    const result = await readJson<{ roleId: string }>(post('{"roleId":"rol_3001"}'));
    expect(result).toEqual({ ok: true, data: { roleId: 'rol_3001' } });
  });

  it('accepts a body of exactly 20 KB', async () => {
    const padding = 'a'.repeat(MAX_BODY_BYTES - '{"note":""}'.length);
    const body = JSON.stringify({ note: padding });
    expect(Buffer.byteLength(body)).toBe(MAX_BODY_BYTES);
    const result = await readJson<{ note: string }>(post(body));
    expect(result.ok).toBe(true);
  });

  it.each([
    ['malformed JSON', '{"roleId":'],
    ['plain text', 'hello'],
  ])('answers 400 { message } for %s', async (_label, body) => {
    const result = await readJson(post(body));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(400);
    expect(await result.response.json()).toEqual({ message: 'Request body is not valid JSON' });
  });

  it.each([
    ['no body', null],
    ['an empty body', ''],
    ['a whitespace body', '   '],
  ])('answers 400 { message } for %s', async (_label, body) => {
    const result = await readJson(post(body));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(400);
    expect(await result.response.json()).toEqual({ message: 'Request body is required and must be JSON' });
  });

  it('answers 413 when Content-Length says the body is over 20 KB', async () => {
    const result = await readJson(post('{}', { 'content-length': String(MAX_BODY_BYTES + 1) }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(413);
    expect(await result.response.json()).toEqual({ message: expect.stringContaining('20 KB') });
  });

  it('answers 413 for an over-size body that declares no length', async () => {
    const chunk = new TextEncoder().encode('x'.repeat(MAX_BODY_BYTES));
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk); // exactly at the limit
        controller.enqueue(chunk); // one chunk past it
        controller.close();
      },
    });
    const req = new Request('http://localhost/api/offers', {
      method: 'POST',
      body: stream,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' }); // duplex is required by Node for stream bodies; not yet in lib.dom types
    expect(req.headers.get('content-length')).toBeNull();
    const result = await readJson(req);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(413);
  });
});
