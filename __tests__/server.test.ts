import type { AddressInfo } from 'node:net';
import request from 'supertest';
import WebSocket from 'ws';
import { useTestServer } from './helpers/server';

const app = useTestServer();

describe('server', () => {
  it('serves the website', async () => {
    const res = await request(app()).get('/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('Sherehe');
  });

  it('hides the framework and sends no ETag (next.config.ts)', async () => {
    const res = await request(app()).get('/');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['etag']).toBeUndefined();
  });
});

describe('unknown API paths', () => {
  it.each(['get', 'post', 'put', 'patch', 'delete'] as const)('answer 404 { message } to %s', async (method) => {
    const res = await request(app())[method]('/api/not-an-endpoint');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.body).toEqual({ message: `No endpoint ${method.toUpperCase()} /api/not-an-endpoint` });
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  it('keep the message short for a very long path', async () => {
    const res = await request(app()).get(`/api/${'a'.repeat(3000)}`);
    expect(res.status).toBe(404);
    expect(res.body.message.length).toBeLessThan(120);
  });
});

describe('proxy.ts (CORS on /api)', () => {
  it('answers a preflight with 204, the CORS headers and no body', async () => {
    const res = await request(app())
      .options('/api/offers')
      .set('Origin', 'https://kaziconnect.example')
      .set('Access-Control-Request-Method', 'POST');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['access-control-allow-methods']).toContain('PATCH');
    expect(res.headers['access-control-allow-headers']).toContain('X-API-Key');
    expect(res.text).toBe('');
  });

  it('adds the CORS headers to ordinary /api responses too', async () => {
    const res = await request(app()).get('/api/events/evt_2001');
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  it('leaves pages outside /api alone', async () => {
    const res = await request(app()).get('/');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('WebSocket upgrades', () => {
  const listen = async () => {
    const server = app();
    if (!server.listening) await new Promise<void>((resolve) => server.listen(0, resolve));
    return (server.address() as AddressInfo).port;
  };

  it('accepts an upgrade on /ws and then closes it with 1008 (no endpoints yet)', async () => {
    const port = await listen();
    const ws = new WebSocket(`ws://localhost:${port}/ws`);
    const closed = await new Promise<{ code: number; reason: string }>((resolve, reject) => {
      ws.on('close', (code, reason) => resolve({ code, reason: reason.toString() }));
      ws.on('error', reject);
    });
    expect(closed.code).toBe(1008);
    expect(closed.reason).toContain('No WebSocket endpoints');
  });

  it('refuses an upgrade on any other path', async () => {
    const port = await listen();
    const ws = new WebSocket(`ws://localhost:${port}/somewhere-else`);
    await expect(
      new Promise((resolve, reject) => {
        ws.on('open', resolve);
        ws.on('error', reject);
      }),
    ).rejects.toThrow();
  });
});
