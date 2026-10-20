import type http from 'node:http';
import request from 'supertest';

let counter = 0;

export interface TestOrganiser {
  id: string;
  email: string;
  token: string;
  /** Pass to Supertest's .set(): request(app).post(...).set(me.auth) */
  auth: { Authorization: string };
}

/** Registers a fresh organiser through the real API and returns their token. */
export async function newOrganiser(server: http.Server, label = 'organiser'): Promise<TestOrganiser> {
  counter += 1;
  const email = `${label}.${counter}.${Date.now()}@example.com`;
  const res = await request(server)
    .post('/api/auth/register')
    .send({ email, name: `Test ${label}`, password: 'test password 123' });
  if (res.status !== 201) throw new Error(`could not register a test organiser: ${res.status} ${JSON.stringify(res.body)}`);
  return { id: res.body.user.id, email, token: res.body.token, auth: { Authorization: `Bearer ${res.body.token}` } };
}
