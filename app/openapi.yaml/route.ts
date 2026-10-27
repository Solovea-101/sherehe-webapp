import fs from 'node:fs/promises';
import path from 'node:path';
import { fail, guard, methodNotAllowed } from '@/lib/http';

// The contract itself, so /docs (and Kazi Connect, and anyone else) read the same file the API is
// checked against by `npm run verify`.
export async function GET() {
  return guard(async () => {
    let yaml: string;
    try {
      yaml = await fs.readFile(path.join(process.cwd(), 'openapi.yaml'), 'utf8');
    } catch {
      return fail(404, 'openapi.yaml was not found on this server');
    }
    return new Response(yaml, {
      headers: {
        'Content-Type': 'application/yaml; charset=utf-8',
        'Cache-Control': 'public, max-age=300',
        'Access-Control-Allow-Origin': '*', // so a Swagger UI hosted elsewhere can read it too
      },
    });
  });
}

export const POST = methodNotAllowed(['GET']);
export const PUT = methodNotAllowed(['GET']);
export const PATCH = methodNotAllowed(['GET']);
export const DELETE = methodNotAllowed(['GET']);
