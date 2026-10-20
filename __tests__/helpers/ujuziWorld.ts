import request from 'supertest';
import type http from 'node:http';
import { clearPartnerCache } from '@/lib/clients/fetcher';
import { newOrganiser, type TestOrganiser } from './auth';
import { inDays } from './dates';
import { startUjuziStub, type UjuziStub } from './ujuziStub';

/** Starts the local Ujuzi before the tests in a file and stops it after; call at the top of a describe. */
export function useUjuziStub(): () => UjuziStub {
  let stub: UjuziStub | undefined;
  beforeAll(async () => {
    stub = await startUjuziStub();
  });
  afterAll(async () => {
    await stub?.close();
    process.env.UJUZI_API_URL = '';
  });
  beforeEach(() => {
    if (!stub) throw new Error('Ujuzi stub did not start');
    stub.reset();
    clearPartnerCache();
    process.env.UJUZI_API_URL = stub.url;
    process.env.UJUZI_API_KEY = '';
    process.env.UJUZI_TIMEOUT_MS = '1000';
  });
  return () => {
    if (!stub) throw new Error('useUjuziStub() must be called at the top of a describe block or file');
    return stub;
  };
}

/** An organiser with one upcoming event 60 days away, made through the real API. */
export async function organiserWithEvent(server: http.Server): Promise<TestOrganiser & { eventId: string; eventStart: string }> {
  const me = await newOrganiser(server);
  const eventStart = inDays(60);
  const event = await request(server).post('/api/events').set(me.auth).send({
    name: 'Wanjiku and Otieno wedding', type: 'wedding', county: 'Nairobi', area: 'Westlands', venue: 'Sarit Expo Centre',
    startsAt: eventStart, endsAt: inDays(60, 20), expectedGuests: 300,
  });
  return { ...me, eventId: event.body.id as string, eventStart };
}
