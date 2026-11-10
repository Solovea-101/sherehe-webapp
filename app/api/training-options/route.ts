import type { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { listCoursesWithFreshness } from '@/lib/clients/ujuziClient';
import { fail, guard, json, methodNotAllowed } from '@/lib/http';
import { toTrainingOption, type ApiTrainingOption } from '@/lib/mappers';
import { parseTrainingQuery } from '@/lib/validation';

// O4 / S1: Ujuzi courses that fit a role, read through Ujuzi (remembered for 5 minutes). If Ujuzi cannot
// be reached, the last good list (up to an hour old) is sent as a saved copy, flagged with the headers
// X-Data-Stale and X-Data-As-Of, and the body stays a bare array. With nothing saved this answers our own
// 502. Every other endpoint keeps working. Certificate checks never do this: a stale yes could be wrong.
export async function GET(req: NextRequest) {
  return guard(async () => {
    const auth = await requireUser(req);
    if (!auth.ok) return auth.response;
    const query = parseTrainingQuery(req.nextUrl.searchParams);
    if (!query.ok) return fail(400, query.message);

    const { courses, asOf } = await listCoursesWithFreshness(query.value);
    return json<ApiTrainingOption[]>(200, courses.map(toTrainingOption), asOf ? { 'X-Data-Stale': 'true', 'X-Data-As-Of': asOf } : undefined);
  });
}

// Any other method gets 405 with the methods this route does support.
export const POST = methodNotAllowed(['GET']);
export const PUT = methodNotAllowed(['GET']);
export const PATCH = methodNotAllowed(['GET']);
export const DELETE = methodNotAllowed(['GET']);
