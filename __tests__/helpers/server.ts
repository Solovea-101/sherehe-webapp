import type http from 'node:http';
import { createServer } from '@/server';

// One server for the whole test file, already listening on a free port. Call useTestServer() at the
// top of a describe block, then pass app() to Supertest: request(app()).get('/api/events').
//
// It listens up front because Supertest otherwise starts and stops a server around every request,
// which falls apart when a test sends many requests at once.
export function useTestServer(): () => http.Server {
  let server: http.Server | undefined;

  beforeAll(async () => {
    server = createServer();
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
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
