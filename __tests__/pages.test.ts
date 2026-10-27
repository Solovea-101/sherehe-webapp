import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { parse as parseYaml } from 'yaml';
import { useTestServer } from './helpers/server';
import { keysOf } from './helpers/shapes';

const app = useTestServer();

describe('the website’s pages are served', () => {
  it.each([
    ['/', 'Upcoming events'],
    ['/login', 'Log in'],
    ['/register', 'Create your account'],
    ['/events/new', 'Checking your login'],
    ['/events/evt_2001', 'Loading event'],
    ['/training', 'Checking your login'],
    ['/certificates', 'Checking your login'],
    ['/docs', 'API documentation'],
  ])('%s answers 200 HTML that says "%s"', async (url, text) => {
    const res = await request(app()).get(url);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain(text);
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('delivers the login and register forms already built, not as an empty shell', async () => {
    for (const url of ['/login', '/register']) {
      const res = await request(app()).get(url);
      expect(res.text).toContain('<form');
      expect(res.text).toMatch(/type="password"/);
    }
    expect((await request(app()).get('/register')).text).toContain('Your name');
    expect((await request(app()).get('/login')).text).not.toContain('Your name');
  });

  it('puts the navigation on every page, with the right links', async () => {
    const res = await request(app()).get('/');
    for (const [href, label] of [['/', 'Events'], ['/events/new', 'Post an event'], ['/training', 'Training'], ['/certificates', 'Certificates'], ['/docs', 'API docs']]) {
      expect(res.text).toMatch(new RegExp(`<a[^>]*href="${href}"[^>]*>${label}</a>`));
    }
    expect(res.text).toContain('<title>Sherehe</title>');
    expect(res.text).toContain('lang="en"');
  });

  it('does not put anyone’s login token, or any key, in the HTML it serves', async () => {
    const res = await request(app()).get('/');
    expect(res.text).not.toMatch(/sherehe\.token|X-API-Key|UJUZI_API_KEY|SESSION_SECRET/);
  });

  it('answers 404 HTML for a page that does not exist, and JSON 404 for an API path', async () => {
    const page = await request(app()).get('/no-such-page');
    expect(page.status).toBe(404);
    expect(page.headers['content-type']).toContain('text/html');
    const api = await request(app()).get('/api/no-such-endpoint');
    expect(api.status).toBe(404);
    expect(keysOf(api.body)).toEqual(['message']);
  });
});

describe('GET /openapi.yaml', () => {
  const onDisk = fs.readFileSync(path.join(process.cwd(), 'openapi.yaml'), 'utf8');

  it('serves exactly the contract file the API is checked against', async () => {
    const res = await request(app()).get('/openapi.yaml').buffer(true).parse((r, cb) => {
      let data = '';
      r.setEncoding('utf8');
      r.on('data', (chunk) => (data += chunk));
      r.on('end', () => cb(null, data));
    });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/yaml');
    expect(res.body).toBe(onDisk);
  });

  it('is a valid OpenAPI 3.0 document that describes every endpoint of the API', async () => {
    const res = await request(app()).get('/openapi.yaml').buffer(true).parse((r, cb) => {
      let data = '';
      r.setEncoding('utf8');
      r.on('data', (chunk) => (data += chunk));
      r.on('end', () => cb(null, data));
    });
    const doc = parseYaml(res.body as string) as { openapi: string; info: { title: string; version: string }; paths: { [p: string]: object } };
    expect(doc.openapi).toMatch(/^3\.0\./);
    expect(doc.info).toMatchObject({ title: 'Sherehe API' });
    expect(Object.keys(doc.paths).sort()).toEqual([
      '/api/auth/login', '/api/auth/logout', '/api/auth/register', '/api/certificate-checks', '/api/crew-trainings',
      '/api/crew-trainings/{trainingId}', '/api/events', '/api/events/{eventId}', '/api/events/{eventId}/offers',
      '/api/events/{eventId}/roles', '/api/me', '/api/offers', '/api/offers/{offerId}', '/api/training-options',
    ]);
  });

  it('can be read from another site, so a Swagger UI hosted elsewhere works', async () => {
    const res = await request(app()).get('/openapi.yaml');
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['cache-control']).toContain('max-age');
  });

  it('is read-only: other methods get 405 { message }', async () => {
    const res = await request(app()).post('/openapi.yaml');
    expect(res.status).toBe(405);
    expect(res.body.message).toBe('POST is not allowed here; use GET');
    expect(res.headers['allow']).toContain('GET');
  });
});
