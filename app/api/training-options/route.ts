import type { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { listCourses } from '@/lib/clients/ujuziClient';
import { fail, guard, json, methodNotAllowed } from '@/lib/http';
import { toTrainingOption, type ApiTrainingOption } from '@/lib/mappers';
import { parseTrainingQuery } from '@/lib/validation';

// O4 / S1: Ujuzi courses that fit a role, read through Ujuzi (remembered for 5 minutes). If Ujuzi
// cannot be reached this answers our own 502; every other endpoint keeps working.
export async function GET(req: NextRequest) {
  return guard(async () => {
    const auth = await requireUser(req);
    if (!auth.ok) return auth.response;
    const query = parseTrainingQuery(req.nextUrl.searchParams);
    if (!query.ok) return fail(400, query.message);

    const courses = await listCourses(query.value);
    return json<ApiTrainingOption[]>(200, courses.map(toTrainingOption));
  });
}

// Any other method gets 405 with the methods this route does support.
export const POST = methodNotAllowed(['GET']);
export const PUT = methodNotAllowed(['GET']);
export const PATCH = methodNotAllowed(['GET']);
export const DELETE = methodNotAllowed(['GET']);
