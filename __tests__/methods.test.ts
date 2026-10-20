import request from 'supertest';
import { useTestServer } from './helpers/server';
import { keysOf } from './helpers/shapes';

const app = useTestServer();

const ALL = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
type Method = (typeof ALL)[number];

// Every route in app/api and the methods it supports, from the contract.
const ROUTES: Array<[path: string, supports: Method[]]> = [
  ['/api/events', ['GET', 'POST']],
  ['/api/events/evt_2001', ['GET']],
  ['/api/events/evt_2001/roles', ['GET', 'POST']],
  ['/api/events/evt_2001/offers', ['GET']],
  ['/api/offers', ['POST']],
  ['/api/offers/ofr_4001', ['GET', 'PATCH', 'DELETE']],
  ['/api/auth/register', ['POST']],
  ['/api/auth/login', ['POST']],
  ['/api/auth/logout', ['POST']],
  ['/api/me', ['GET']],
  ['/api/training-options', ['GET']],
  ['/api/crew-trainings', ['GET', 'POST']],
  ['/api/crew-trainings/trn_5001', ['GET', 'PUT', 'DELETE']],
  ['/api/certificate-checks', ['POST']],
];

const send = (method: Method, path: string) => request(app())[method.toLowerCase() as Lowercase<Method>](path);

describe('a method a route does not support', () => {
  const cases = ROUTES.flatMap(([path, supports]) => ALL.filter((m) => !supports.includes(m)).map((m) => [m, path, supports] as const));

  it.each(cases)('%s %s answers 405 { message } with an Allow header', async (method, path, supports) => {
    const res = await send(method, path);
    expect(res.status).toBe(405);
    expect(res.headers['content-type']).toContain('application/json');
    expect(keysOf(res.body)).toEqual(['message']);
    expect(res.body.message).toBe(`${method} is not allowed here; use ${supports.join(' or ')}`);
    const allow = res.headers['allow'].split(', ');
    expect(allow).toEqual(expect.arrayContaining([...supports, 'OPTIONS']));
    expect(allow.includes('HEAD')).toBe(supports.includes('GET'));
    expect(res.headers['access-control-allow-origin']).toBe('*'); // browsers can read the error
  });

  it('is never reached by a request that is checked first: the wrong method needs no login', async () => {
    const res = await request(app()).delete('/api/me');
    expect(res.status).toBe(405);
  });
});

describe('a method a route does support', () => {
  const supported = ROUTES.flatMap(([path, supports]) => supports.map((m) => [m, path] as const));
  it.each(supported)('%s %s is not answered with 405', async (method, path) => {
    const res = await send(method, path);
    expect(res.status).not.toBe(405);
  });
});
