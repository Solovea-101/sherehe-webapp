import http from 'node:http';
import path from 'node:path';
import { loadEnvConfig } from '@next/env';
import next from 'next';
import { WebSocketServer } from 'ws';
import { describePartnerKeys } from '@/lib/auth/partnerKeyConfig';
import { getStore } from '@/lib/db';
import { startBookingPoller } from '@/lib/jobs/bookingPoller';

// The one path where our own WebSocket upgrades are accepted. Next.js keeps /_next/* (dev hot reload).
const WS_PATH = '/ws';

// `npm run dev` leaves NODE_ENV unset, `npm start` sets production, Jest sets test. Only the
// first runs Next.js in dev mode; tests use the output of `next build`.
const isDev = () => process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test';

/**
 * The caller's address. Behind Render's proxy the socket is the proxy, so with TRUST_PROXY=true the
 * last entry of X-Forwarded-For (the one the proxy itself added) is used instead.
 */
function clientAddress(req: http.IncomingMessage): string {
  if (process.env.TRUST_PROXY === 'true') {
    const forwarded = req.headers['x-forwarded-for'];
    const last = (Array.isArray(forwarded) ? forwarded.join(',') : forwarded ?? '').split(',').pop()?.trim();
    if (last) return last;
  }
  return req.socket.remoteAddress ?? 'unknown';
}

/**
 * Builds the HTTP server around Next.js (website and /api routes) without listening, so Supertest
 * can drive it. Requests wait for Next.js to finish preparing.
 */
export function createServer(): http.Server {
  const port = Number(process.env.PORT) || 3000;
  const server = http.createServer();
  const app = next({ dev: isDev(), dir: process.cwd(), hostname: 'localhost', port, httpServer: server });
  const handle = app.getRequestHandler();
  const ready = app.prepare();
  ready.catch((err: unknown) => console.error('Next.js failed to start:', err));

  server.on('request', async (req, res) => {
    // Who is calling, for the rate limiter. Always set here, so a caller cannot choose its own value.
    req.headers['x-sherehe-client-ip'] = clientAddress(req);
    try {
      await ready;
      await handle(req, res);
    } catch (err) {
      console.error('Unhandled error while serving', req.method, req.url, err);
      if (res.headersSent) {
        res.end();
      } else {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ message: 'Internal server error' }));
      }
    }
  });

  // WebSocket upgrades. No feature uses them yet, so a connection is refused politely (1008).
  const wss = new WebSocketServer({ noServer: true });
  wss.on('connection', (socket) => socket.close(1008, 'No WebSocket endpoints are defined yet'));
  server.on('upgrade', (req, socket, head) => {
    const { pathname } = new URL(req.url ?? '/', 'http://localhost');
    if (pathname === WS_PATH) {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    } else if (!pathname.startsWith('/_next/')) {
      socket.destroy(); // nothing else upgrades; Next.js's own listener handles /_next/*
    }
  });
  // noServer mode owns no sockets, so closing means dropping connected clients. Not wss.close():
  // an http.Server can listen again after closing (Supertest does this), and wss must still work.
  server.on('close', () => wss.clients.forEach((client) => client.terminate()));

  return server;
}

// Run directly (`tsx server.ts`), not when a test imports createServer.
if (path.basename(process.argv[1] ?? '') === 'server.ts') {
  loadEnvConfig(process.cwd(), isDev());
  const port = Number(process.env.PORT) || 3000;
  const server = createServer();
  server.listen(port, () => {
    console.log(`> Sherehe listening on http://localhost:${port} (${isDev() ? 'development' : process.env.NODE_ENV})`);
  });
  const partnerKeys = describePartnerKeys(); // a count and names, never a key
  console[partnerKeys.level](partnerKeys.text);
  // Open the database now, not on the first request: tables are made and sample data loaded while a
  // deploy is still starting, and a database that cannot be reached shows in the log straight away.
  void getStore().then(
    () => console.log(`Database ready (${process.env.DATABASE_URL ? 'PostgreSQL' : 'in memory'})`),
    (err: unknown) => console.error('Database not ready; it will be tried again on the next request:', err instanceof Error ? err.message : err),
  );
  const stopPoller = startBookingPoller();

  // Render sends SIGTERM when it replaces an instance; finish in-flight requests, then leave.
  process.on('SIGTERM', () => {
    stopPoller();
    server.close(() => process.exit(0));
    server.closeIdleConnections();
    setTimeout(() => process.exit(0), 10_000).unref();
  });
}
