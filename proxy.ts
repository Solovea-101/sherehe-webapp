import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Next.js 16's name for middleware. Runs only on /api/*: adds CORS headers and answers preflights.
// Auth is a header (X-API-Key) or a bearer token, never a cookie, so a wildcard origin is safe.
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
  'Access-Control-Max-Age': '86400',
};

export function proxy(request: NextRequest) {
  if (request.method === 'OPTIONS') {
    return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
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
