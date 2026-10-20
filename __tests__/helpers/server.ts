import type http from 'node:http';
import { createServer } from '@/server';

// One server for the whole test file. Call useTestServer() at the top of a describe block, then
// pass app() to Supertest: request(app()).get('/api/events').
export function useTestServer(): () => http.Server {
  let server: http.Server | undefined;

  beforeAll(() => {
    server = createServer();
  });

  afterAll(async () => {
    if (!server) return;
    server.closeAllConnections();
    if (server.listening) {
      await new Promise<void>((resolve) => server?.close(() => resolve()));
    }
  });

  return () => {
    if (!server) throw new Error('useTestServer() must be called inside a describe block or at file top level');
    return server;
  };
}
