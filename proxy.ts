import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { checkRequest } from '@/lib/rateLimit';

// Next.js 16's name for middleware. Runs only on /api/*: adds CORS headers and answers preflights.
// Auth is a header (X-API-Key) or a bearer token, never a cookie, so a wildcard origin is safe.
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
  'Access-Control-Expose-Headers': 'Location, Retry-After, X-Data-Stale, X-Data-As-Of', // so a browser page can read them
  'Access-Control-Max-Age': '86400',
};

// Set by server.ts from the socket, never taken from the caller (it overwrites any such header).
const CLIENT_IP_HEADER = 'x-sherehe-client-ip';

export function proxy(request: NextRequest) {
  if (request.method === 'OPTIONS') {
    return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
  }
  const decision = checkRequest({
    method: request.method,
    pathname: request.nextUrl.pathname,
    key: request.headers.get('x-api-key'),
    clientIp: request.headers.get(CLIENT_IP_HEADER),
  });
  if (decision.limited) {
    // The same { message } shape as every error, plus how long to wait; CORS headers so a browser can read it.
    return NextResponse.json(
      { message: 'Too many requests. Wait a little and try again.', retryAfter: decision.retryAfter },
      { status: 429, headers: { ...CORS_HEADERS, 'Retry-After': String(decision.retryAfter) } },
    );
  }
  const response = NextResponse.next();
  for (const [name, value] of Object.entries(CORS_HEADERS)) {
    response.headers.set(name, value);
  }
  return response;
}

export const config = {
  matcher: '/api/:path*',
};
