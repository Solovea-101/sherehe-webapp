/**
 * `npm run verify`: checks the running API against openapi.yaml and writes VERIFICATION.md.
 *
 * It starts the real server (built Next.js app, in-memory store), sends real HTTP requests to every
 * endpoint that is implemented, and checks each response against the contract: the status must be
 * one the contract documents for that operation, the body must match that status's schema, objects
 * are treated as closed (an extra field fails just like a missing one), and dates must be ISO 8601
 * UTC with a Z and no milliseconds. It also checks that openapi.yaml is valid OpenAPI and that the
 * examples inside it match their own schemas, and that reading data changed nothing.
 *
 * Writes are checked harder: a successful write is read back with a GET to confirm it stuck, and a
 * rejected write is checked to have changed nothing.
 *
 * Operations in the contract that have no case yet are listed as "not yet verified", never as passed.
 */
import fs from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import SwaggerParser from '@apidevtools/swagger-parser';
import Ajv from 'ajv';
import { getStore } from '@/lib/db';
import type { Store } from '@/lib/db/types';
import { createServer } from '@/server';
import { buildCases, isObject, type Case, type Ctx, type Env, type JsonObject } from './verifyCases';

// ---- the contract, as loaded and dereferenced by swagger-parser ------------------------------

interface ContractResponse {
  content?: { [mediaType: string]: { schema?: JsonObject; example?: unknown } };
}
interface ContractOperation {
  responses: { [status: string]: ContractResponse };
}
interface Contract {
  info: { version: string };
  paths: { [path: string]: { [method: string]: unknown } };
}
const METHODS = ['get', 'put', 'post', 'delete', 'patch'] as const;

// ---- schema checking -------------------------------------------------------------------------

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

function makeAjv(): Ajv {
  // strict: false because OpenAPI schemas carry keywords JSON Schema does not know (example, ...).
  const ajv = new Ajv({ strict: false, allErrors: true });
  // Stricter than ajv's own date-time: the whole ring writes UTC, a Z and no milliseconds.
  ajv.addFormat('date-time', {
    type: 'string',
    validate: (value: string) => ISO_UTC.test(value) && !Number.isNaN(Date.parse(value)),
  });
  ajv.addFormat('date', {
    type: 'string',
    validate: (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)),
  });
  return ajv;
}

/** Marks every object schema that lists properties as closed, so unexpected fields are errors. */
function closeObjects(node: unknown, seen = new WeakSet<object>()): void {
  if (!isObject(node) && !Array.isArray(node)) return;
  if (seen.has(node)) return;
  seen.add(node);
  if (isObject(node) && node.type === 'object' && isObject(node.properties) && node.additionalProperties === undefined) {
    node.additionalProperties = false;
  }
  for (const child of Object.values(node)) closeObjects(child, seen);
}

/** Every `example` in the contract must be a valid value for the schema it sits beside. */
function checkExamples(contract: unknown, ajv: Ajv): { checked: number; problems: string[] } {
  const problems: string[] = [];
  let checked = 0;
  const seen = new WeakSet<object>();
  const visit = (node: unknown, where: string): void => {
    if (!isObject(node) && !Array.isArray(node)) return;
    if (seen.has(node)) return;
    seen.add(node);
    if (isObject(node) && 'example' in node) {
      const schema = isObject(node.schema) ? node.schema : node.type !== undefined ? node : undefined;
      if (schema) {
        checked += 1;
        const validate = ajv.compile(schema);
        if (!validate(node.example)) {
          problems.push(`${where}: example ${JSON.stringify(node.example)} ${ajv.errorsText(validate.errors)}`);
        }
      }
    }
    for (const [key, child] of Object.entries(node)) visit(child, `${where}/${key}`);
  };
  visit(contract, '');
  return { checked, problems };
}

// ---- running ---------------------------------------------------------------------------------

interface Outcome {
  case: Case;
  /** The URL actually requested. */
  url: string;
  status: number | 'no reply';
  problems: string[];
}

type Validator = ReturnType<Ajv['compile']>;

/** Everything stored that a request could change and that the store lets us list. */
async function snapshot(store: Store, ctx: Ctx): Promise<string> {
  const events = await store.events.list();
  const roles = (await Promise.all(events.map((e) => store.roles.listByEvent(e.id)))).flat();
  const offers = (await Promise.all(events.map((e) => store.offers.listByEvent(e.id)))).flat();
  const ids = Object.values(ctx).filter((value) => value.startsWith('usr_')); // organisers seen so far
  const trainings = (await Promise.all(ids.map((id) => store.crewTrainings.listByOrganiser(id)))).flat();
  const checks = (await Promise.all(ids.map((id) => store.certificateChecks.listByOrganiser(id)))).flat();
  return JSON.stringify({ events, roles, offers, trainings, checks });
}

async function runCase(
  c: Case,
  env: Env,
  base: string,
  contract: Contract,
  validators: Map<string, Validator>,
  ajv: Ajv,
): Promise<Outcome> {
  const problems: string[] = [];
  const [method, specPath] = c.operation.split(' ') as [string, string];
  let url = typeof c.url === 'string' ? c.url : c.operation;
  let headers: { [name: string]: string };
  let payload: string | undefined = c.rawBody;
  try {
    // A case may use values captured by earlier ones; if one is missing, say so instead of crashing.
    await c.before?.(env);
    url = typeof c.url === 'function' ? c.url(env.ctx) : c.url;
    headers = { Accept: 'application/json', ...(c.headers?.(env.ctx) ?? {}) };
    if (payload === undefined && c.body !== undefined) {
      const value = typeof c.body === 'function' ? (c.body as (ctx: Ctx) => unknown)(env.ctx) : c.body;
      payload = JSON.stringify(value);
    }
  } catch (err) {
    return { case: c, url, status: 'no reply', problems: [err instanceof Error ? err.message : String(err)] };
  }
  if (payload !== undefined) headers['Content-Type'] = 'application/json';

  const before = c.unchanged ? await snapshot(env.store, env.ctx) : undefined;
  let res: Response;
  try {
    res = await fetch(base + url, { method, headers, body: payload, signal: AbortSignal.timeout(60_000) });
  } catch (err) {
    return { case: c, url, status: 'no reply', problems: [`request failed: ${err instanceof Error ? err.message : String(err)}`] };
  }

  const operation = contract.paths[specPath]?.[method.toLowerCase()] as ContractOperation | undefined;
  const documented = operation?.responses[String(res.status)];
  if (res.status !== c.expectStatus) problems.push(`expected status ${c.expectStatus}, got ${res.status}`);
  if (!documented) problems.push(`status ${res.status} is not documented for ${c.operation}`);

  for (const [name, expected] of Object.entries(c.expectHeaders ?? {})) {
    const actual = res.headers.get(name);
    const ok = typeof expected === 'string' ? actual === expected : actual !== null && expected.test(actual);
    if (!ok) problems.push(`header ${name} is "${actual}", expected ${expected}`);
  }

  const text = await res.text();
  const schema = documented?.content?.['application/json']?.schema;
  let body: unknown;
  if (schema) {
    if (!(res.headers.get('content-type') ?? '').includes('application/json')) {
      problems.push(`content-type is "${res.headers.get('content-type')}", not application/json`);
    }
    try {
      body = JSON.parse(text);
    } catch {
      problems.push('body is not valid JSON');
    }
    if (body !== undefined) {
      const key = `${c.operation} ${res.status}`;
      let validate = validators.get(key);
      if (!validate) {
        validate = ajv.compile(schema);
        validators.set(key, validate);
      }
      if (!validate(body)) problems.push(`body does not match the schema: ${ajv.errorsText(validate.errors)}`);
      const extra = c.check?.(body, env.ctx);
      if (extra) problems.push(extra);
      if (res.status === c.expectStatus) c.capture?.(body, env.ctx);
    }
  } else if (documented && text !== '') {
    problems.push('the contract documents no body for this status, but one was sent');
  } else if (res.status === c.expectStatus) {
    c.capture?.(undefined, env.ctx);
  }

  if (c.after) problems.push(...(await c.after(env, body)));
  if (before !== undefined && (await snapshot(env.store, env.ctx)) !== before) {
    problems.push('the request was rejected but stored data changed');
  }
  return { case: c, url, status: res.status, problems };
}

// ---- report ----------------------------------------------------------------------------------

function renderReport(args: {
  version: string;
  examples: { checked: number; problems: string[] };
  outcomes: Outcome[];
  unverified: string[];
}): string {
  const { version, examples, outcomes, unverified } = args;
  const checkedUnchanged = outcomes.filter((o) => o.case.unchanged).length;
  const mutated = outcomes.filter((o) => o.problems.some((p) => p.includes('stored data changed')));
  const passed = outcomes.filter((o) => o.problems.length === 0).length;
  const mark = (ok: boolean) => (ok ? 'pass' : '**FAIL**');
  const lines: string[] = [];
  lines.push('## Latest run', '');
  lines.push(`Run on ${new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')} against contract version ${version}.`, '');
  lines.push(`**${passed} of ${outcomes.length} cases passed.** ${unverified.length} operation(s) in the contract are not verified yet (listed at the end).`, '');
  lines.push('### Contract checks', '');
  lines.push('| Check | Result |', '|---|---|');
  lines.push('| openapi.yaml is valid OpenAPI 3.0 and every $ref resolves | pass |');
  lines.push(`| ${examples.checked} examples in openapi.yaml match their own schemas | ${mark(examples.problems.length === 0)} |`);
  lines.push(`| ${checkedUnchanged} reads and rejected writes changed nothing (store compared before and after each) | ${mutated.length ? `**FAIL**: ${mutated.length} changed data` : 'pass'} |`);
  for (const problem of examples.problems) lines.push(`| (example problem) | ${problem.replace(/\|/g, '\\|')} |`);
  lines.push('', '### Requests sent', '');
  lines.push('| # | Operation | Case | Request | Expected | Got | Result |', '|---|---|---|---|---|---|---|');
  outcomes.forEach((o, i) => {
    const result = o.problems.length === 0 ? 'pass' : `**FAIL**: ${o.problems.join('; ').replace(/\|/g, '\\|')}`;
    lines.push(`| ${i + 1} | \`${o.case.operation}\` | ${o.case.label} | \`${o.url}\` | ${o.case.expectStatus} | ${o.status} | ${result} |`);
  });
  lines.push('', '### What each request is checked for', '');
  lines.push(
    '- the status is the one expected, and the contract documents it for that operation',
    '- the body is JSON and matches that status\'s schema: required fields present, no extra fields, types, enums, minimums',
    '- every `date-time` is ISO 8601 UTC with a `Z` and no milliseconds',
    '- case-specific rules: filtering, ordering, which ids appear, which message an error gives',
    '- a successful write is read back to confirm it stuck; a rejected write is checked to have changed nothing',
  );
  lines.push('', '### Not yet verified', '');
  if (unverified.length === 0) lines.push('Every operation in the contract has at least one case.');
  else {
    lines.push('These operations are in `openapi.yaml` but have no case yet. They are not implemented in this phase, so nothing is claimed about them.', '');
    for (const op of unverified) lines.push(`- \`${op}\``);
  }
  return lines.join('\n') + '\n';
}

async function main(): Promise<number> {
  if (process.env.NODE_ENV !== 'production') {
    console.error('Run this through `npm run verify`, which builds the app and sets NODE_ENV=production.');
    return 1;
  }
  process.env.DATABASE_URL = ''; // always the in-memory store: this script writes fixtures into it

  const root = process.cwd();
  const contractFile = path.join(root, 'openapi.yaml');

  // 1. The contract itself.
  let contract: Contract;
  try {
    contract = (await SwaggerParser.validate(contractFile)) as unknown as Contract; // validated just now
  } catch (err) {
    console.error('openapi.yaml is not valid OpenAPI:', err instanceof Error ? err.message : err);
    return 1;
  }
  const ajv = makeAjv();
  const examples = checkExamples(contract, ajv);
  closeObjects(contract);

  // 2. The server, with fixtures for the cases the sample data cannot cover.
  const store = await getStore();
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const ctx: Ctx = {};
  const env: Env = {
    ctx,
    store,
    get: async (p, token) => {
      const res = await fetch(base + p, {
        headers: token ? { Accept: 'application/json', Authorization: `Bearer ${token}` } : { Accept: 'application/json' },
      });
      const raw = await res.text();
      return { status: res.status, body: raw ? JSON.parse(raw) : undefined };
    },
  };

  // 3. Every case, in order: later cases use tokens and ids captured by earlier ones.
  const cases = await buildCases(env);
  const validators = new Map<string, Validator>();
  const outcomes: Outcome[] = [];
  for (const c of cases) outcomes.push(await runCase(c, env, base, contract, validators, ajv));

  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));

  // 4. What the contract has that nothing exercised.
  const covered = new Set(cases.map((c) => c.operation));
  const unverified: string[] = [];
  for (const [p, item] of Object.entries(contract.paths)) {
    for (const m of METHODS) {
      if (item[m] && !covered.has(`${m.toUpperCase()} ${p}`)) unverified.push(`${m.toUpperCase()} ${p}`);
    }
  }

  // 5. Console summary and VERIFICATION.md.
  for (const o of outcomes) {
    console.log(`${o.problems.length === 0 ? 'PASS' : 'FAIL'}  ${o.case.operation.padEnd(40)} ${o.case.label}  [${o.status}]`);
    for (const problem of o.problems) console.log(`      ${problem}`);
  }
  console.log(`contract: valid OpenAPI; examples: ${examples.checked} checked, ${examples.problems.length} problem(s)`);
  for (const problem of examples.problems) console.log(`      ${problem}`);
  if (unverified.length) console.log(`not yet verified: ${unverified.join(', ')}`);

  const reportFile = path.join(root, 'VERIFICATION.md');
  const existing = await fs.readFile(reportFile, 'utf8');
  const head = existing.split('\n## Latest run')[0].replace(/\n*Not generated yet\.\s*$/, '').trimEnd();
  await fs.writeFile(
    reportFile,
    `${head}\n\n${renderReport({ version: contract.info.version, examples, outcomes, unverified })}`,
  );

  const failed = outcomes.filter((o) => o.problems.length > 0).length;
  const ok = failed === 0 && examples.problems.length === 0;
  console.log(ok ? `\nAll ${outcomes.length} cases passed. VERIFICATION.md written.` : `\n${failed} case(s) failed. VERIFICATION.md written.`);
  return ok ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
