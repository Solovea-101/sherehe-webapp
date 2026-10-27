import { NextResponse, type NextRequest } from 'next/server';
import { PartnerUnavailableError } from '@/lib/clients/fetcher';

export const MAX_BODY_BYTES = 20 * 1024;

export type ErrorBody = { message: string };

export type ReadJsonResult<T> =
  | { ok: true; data: T }
  | { ok: false; response: NextResponse<ErrorBody> };

export function json<T>(status: number, body: T, headers?: HeadersInit): NextResponse<T> {
  return NextResponse.json(body, { status, headers });
}

export function fail(status: number, message: string, headers?: HeadersInit): NextResponse<ErrorBody> {
  return json<ErrorBody>(status, { message }, headers);
}

export function noContent(): NextResponse {
  return new NextResponse(null, { status: 204 });
}

/** 404 { message } naming the thing asked for, e.g. "Event evt_9999 not found". */
export function notFound(what: string, id: string): NextResponse<ErrorBody> {
  const shown = id.length > 50 ? `${id.slice(0, 50)}...` : id; // ids come from the URL; keep the echo short
  return fail(404, `${what} ${shown} not found`);
}

/**
 * Runs a handler's work and turns anything it throws into { message }, so even a bug answers in our
 * error format instead of an empty reply: 502 when a partner (Ujuzi) is the problem, 500 otherwise.
 * The details go to the server log, never to the client.
 *
 *   export async function GET(req: NextRequest) {
 *     return guard(async () => { ... });
 *   }
 */
export async function guard(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof PartnerUnavailableError) {
      // Their problem, not a bug of ours: log what happened, tell our client in our own words.
      console.warn(`Partner unavailable: ${err.message}`);
      return fail(502, `${err.partner} is not responding right now. Try again in a minute.`);
    }
    console.error('Unhandled error in an API handler:', err);
    return fail(500, 'Something went wrong on our side. Please try again.');
  }
}

/**
 * Reads a JSON request body. Answers 400 for an empty or malformed body and 413 when it is over
 * 20 KB. T is the shape the caller expects; nothing is checked here, so validate the result
 * (lib/validation.ts) before using it.
 *
 *   const body = await readJson<NewOffer>(req);
 *   if (!body.ok) return body.response;
 */
export async function readJson<T = unknown>(req: Request): Promise<ReadJsonResult<T>> {
  const tooLarge = () =>
    fail(413, `Request body is too large; send at most ${MAX_BODY_BYTES / 1024} KB of JSON`);

  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return { ok: false, response: tooLarge() };
  }

  // Content-Length can be missing or wrong (chunked uploads), so count the bytes as they arrive.
  const chunks: Uint8Array[] = [];
  let received = 0;
  if (req.body) {
    const reader = req.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_BODY_BYTES) {
        await reader.cancel();
        return { ok: false, response: tooLarge() };
      }
      chunks.push(value);
    }
  }

  const text = Buffer.concat(chunks).toString('utf8');
  if (text.trim() === '') {
    return { ok: false, response: fail(400, 'Request body is required and must be JSON') };
  }
  try {
    return { ok: true, data: JSON.parse(text) as T };
  } catch {
    return { ok: false, response: fail(400, 'Request body is not valid JSON') };
  }
}

/**
 * A handler for the HTTP methods a route does not support, so a wrong method gets 405 { message }
 * and an Allow header instead of an empty reply. Each route file exports one for every method it
 * lacks:  export const PUT = methodNotAllowed(['GET', 'POST']);
 */
export function methodNotAllowed(allowed: readonly string[]) {
  const allow = [...allowed, ...(allowed.includes('GET') ? ['HEAD'] : []), 'OPTIONS'].join(', ');
  return (req: NextRequest): NextResponse<ErrorBody> =>
    fail(405, `${req.method} is not allowed here; use ${allowed.join(' or ')}`, { Allow: allow });
}
