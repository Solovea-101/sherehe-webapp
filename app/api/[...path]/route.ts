import type { NextRequest } from 'next/server';
import { fail } from '@/lib/http';

// Any /api path no other route claims answers 404 { message } rather than an HTML error page, so
// every failure a client can see has the same shape.
function unknownEndpoint(req: NextRequest) {
  const path = req.nextUrl.pathname;
  return fail(404, `No endpoint ${req.method} ${path.length > 80 ? `${path.slice(0, 80)}...` : path}`);
}

export const GET = unknownEndpoint;
export const POST = unknownEndpoint;
export const PUT = unknownEndpoint;
export const PATCH = unknownEndpoint;
export const DELETE = unknownEndpoint;
