import type { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { getCertificate } from '@/lib/clients/ujuziClient';
import { getStore } from '@/lib/db';
import { fail, guard, json, methodNotAllowed, notFound, readJson } from '@/lib/http';
import { toCertificateCheck, type ApiCertificateCheck } from '@/lib/mappers';
import { parseNewCertificateCheck } from '@/lib/validation';

// O5 / S2: check a crew member's certificate with Ujuzi, right now (never from a remembered answer,
// so a revocation shows at once), and keep a record of the check. A number Ujuzi does not know
// answers 404 and is not recorded; a revoked certificate is real, so it is recorded with valid false.
export async function POST(req: NextRequest) {
  return guard(async () => {
    const auth = await requireUser(req);
    if (!auth.ok) return auth.response;
    const body = await readJson(req);
    if (!body.ok) return body.response;
    const input = parseNewCertificateCheck(body.data);
    if (!input.ok) return fail(400, input.message);

    const certificate = await getCertificate(input.value.certificateNo);
    if (!certificate) return notFound('Certificate', input.value.certificateNo);

    const store = await getStore();
    const row = await store.certificateChecks.create({
      organiser_id: auth.user.id,
      certificate_no: certificate.certificateNo,
      valid: certificate.valid,
      course_title: certificate.courseTitle,
      level: certificate.level,
      issued_on: certificate.issuedOn,
      holder: certificate.holder,
    });
    return json<ApiCertificateCheck>(201, toCertificateCheck(row), { 'Cache-Control': 'no-store' });
  });
}

// Any other method gets 405 with the methods this route does support.
export const GET = methodNotAllowed(['POST']);
export const PUT = methodNotAllowed(['POST']);
export const PATCH = methodNotAllowed(['POST']);
export const DELETE = methodNotAllowed(['POST']);
