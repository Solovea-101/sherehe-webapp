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

// ---- the contract, as loaded and dereferenced by swagger-parser ------------------------------

type JsonObject = { [key: string]: unknown };
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

const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

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

// ---- cases -----------------------------------------------------------------------------------

interface Case {
  /** The operation as the contract writes it, e.g. "GET /api/events/{eventId}". */
  operation: string;
  label: string;
  /** Path and query actually requested. */
  url: string;
  expectStatus: number;
  /** Extra checks on the parsed body; return a problem description, or undefined when fine. */
  check?: (body: unknown) => string | undefined;
}

interface Outcome {
  case: Case;
  status: number | 'no reply';
  problems: string[];
}

const asArray = (body: unknown): JsonObject[] => (Array.isArray(body) ? body.filter(isObject) : []);

function buildCases(fixture: { bareEventId: string; offerId: string }): Case[] {
  const upcomingSortedBy = (field: string) => (body: unknown) => {
    const values = asArray(body).map((item) => String(item[field]));
    return values.join() === [...values].sort().join() ? undefined : `not sorted by ${field}`;
  };
  const allHave = (field: string, expected: string) => (body: unknown) => {
    const bad = asArray(body).filter((item) => item[field] !== expected);
    return bad.length ? `${bad.length} item(s) with ${field} other than ${expected}` : undefined;
  };
  const both = (...checks: Array<(body: unknown) => string | undefined>) => (body: unknown) =>
    checks.map((c) => c(body)).find((problem) => problem !== undefined);
  const includes = (id: string) => (body: unknown) =>
    asArray(body).some((item) => item.id === id) ? undefined : `${id} is missing`;
  const excludes = (id: string) => (body: unknown) =>
    asArray(body).some((item) => item.id === id) ? `${id} should not be listed` : undefined;
  const isEmptyArray = (body: unknown) => (Array.isArray(body) && body.length === 0 ? undefined : 'expected []');
  const messageContains = (text: string) => (body: unknown) =>
    isObject(body) && typeof body.message === 'string' && body.message.includes(text)
      ? undefined
      : `message does not mention "${text}"`;
  const hasId = (id: string) => (body: unknown) => (isObject(body) && body.id === id ? undefined : `id is not ${id}`);

  return [
    // K1: GET /api/events
    { operation: 'GET /api/events', label: 'upcoming events', url: '/api/events?status=upcoming', expectStatus: 200,
      check: both(allHave('status', 'upcoming'), upcomingSortedBy('startsAt'), includes('evt_2001'), excludes('evt_2007')) },
    { operation: 'GET /api/events', label: 'county filter, lower case', url: '/api/events?status=upcoming&county=nairobi', expectStatus: 200,
      check: both(allHave('county', 'Nairobi'), includes('evt_2001'), excludes('evt_2006')) },
    { operation: 'GET /api/events', label: 'county filter, upper case', url: '/api/events?status=upcoming&county=MOMBASA', expectStatus: 200,
      check: both(allHave('county', 'Mombasa'), includes('evt_2006')) },
    { operation: 'GET /api/events', label: 'real county with no events', url: '/api/events?status=upcoming&county=Turkana', expectStatus: 200,
      check: isEmptyArray },
    { operation: 'GET /api/events', label: 'status missing', url: '/api/events', expectStatus: 400,
      check: messageContains('status is required') },
    { operation: 'GET /api/events', label: 'status not upcoming', url: '/api/events?status=completed', expectStatus: 400,
      check: messageContains('status must be upcoming') },
    { operation: 'GET /api/events', label: 'county is not a county', url: '/api/events?status=upcoming&county=Narnia', expectStatus: 400,
      check: messageContains('47 counties') },

    // K1: GET /api/events/{eventId}
    { operation: 'GET /api/events/{eventId}', label: 'an upcoming event', url: '/api/events/evt_2001', expectStatus: 200,
      check: hasId('evt_2001') },
    { operation: 'GET /api/events/{eventId}', label: 'an event that is over', url: '/api/events/evt_2007', expectStatus: 200,
      check: (body) => (isObject(body) && body.status === 'completed' ? undefined : 'status is not completed') },
    { operation: 'GET /api/events/{eventId}', label: 'unknown id', url: '/api/events/evt_9999', expectStatus: 404,
      check: messageContains('evt_9999') },

    // K2: GET /api/events/{eventId}/roles
    { operation: 'GET /api/events/{eventId}/roles', label: 'an event with roles', url: '/api/events/evt_2001/roles', expectStatus: 200,
      check: both(
        (body) => (asArray(body).length === 2 ? undefined : 'expected 2 roles'),
        (body) => (asArray(body).every((r) => r.eventId === 'evt_2001') ? undefined : 'a role belongs to another event'),
      ) },
    { operation: 'GET /api/events/{eventId}/roles', label: 'an event with no roles', url: `/api/events/${fixture.bareEventId}/roles`, expectStatus: 200,
      check: isEmptyArray },
    { operation: 'GET /api/events/{eventId}/roles', label: 'unknown event', url: '/api/events/evt_9999/roles', expectStatus: 404,
      check: messageContains('evt_9999') },

    // K4: GET /api/offers/{offerId}
    { operation: 'GET /api/offers/{offerId}', label: 'a pending offer', url: `/api/offers/${fixture.offerId}`, expectStatus: 200,
      check: both(hasId(fixture.offerId), (body) => (isObject(body) && body.status === 'pending' ? undefined : 'status is not pending')) },
    { operation: 'GET /api/offers/{offerId}', label: 'unknown id', url: '/api/offers/ofr_9999', expectStatus: 404,
      check: messageContains('ofr_9999') },
  ];
}

// ---- running ---------------------------------------------------------------------------------

async function snapshot(store: Store): Promise<string> {
  const events = await store.events.list();
  const roles = (await Promise.all(events.map((e) => store.roles.listByEvent(e.id)))).flat();
  const offers = (await Promise.all(events.map((e) => store.offers.listByEvent(e.id)))).flat();
  return JSON.stringify({ events, roles, offers });
}

async function runCase(
  c: Case,
  base: string,
  contract: Contract,
  validators: Map<string, ReturnType<Ajv['compile']>>,
  ajv: Ajv,
): Promise<Outcome> {
  const problems: string[] = [];
  let res: Response;
  try {
    res = await fetch(base + c.url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(60_000) });
  } catch (err) {
    return { case: c, status: 'no reply', problems: [`request failed: ${err instanceof Error ? err.message : String(err)}`] };
  }

  const [method, specPath] = c.operation.split(' ') as [string, string];
  const operation = contract.paths[specPath]?.[method.toLowerCase()] as ContractOperation | undefined;
  const documented = operation?.responses[String(res.status)];
  if (res.status !== c.expectStatus) problems.push(`expected status ${c.expectStatus}, got ${res.status}`);
  if (!documented) problems.push(`status ${res.status} is not documented for ${c.operation}`);

  const text = await res.text();
  const schema = documented?.content?.['application/json']?.schema;
  if (schema) {
    if (!(res.headers.get('content-type') ?? '').includes('application/json')) {
      problems.push(`content-type is "${res.headers.get('content-type')}", not application/json`);
    }
    let body: unknown;
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
      const extra = c.check?.(body);
      if (extra) problems.push(extra);
    }
  } else if (documented && text !== '') {
    problems.push('the contract documents no body for this status, but one was sent');
  }
  return { case: c, status: res.status, problems };
}

// ---- report ----------------------------------------------------------------------------------

function renderReport(args: {
  version: string;
  examples: { checked: number; problems: string[] };
  outcomes: Outcome[];
  unverified: string[];
  readOnlyProblem?: string;
}): string {
  const { version, examples, outcomes, unverified, readOnlyProblem } = args;
  const passed = outcomes.filter((o) => o.problems.length === 0).length;
  const mark = (ok: boolean) => (ok ? 'pass' : '**FAIL**');
  const lines: string[] = [];
  lines.push('## Latest run', '');
  lines.push(`Run on ${new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')} against contract version ${version}.`, '');
  lines.push(`**${passed} of ${outcomes.length} cases passed.** ${unverified.length} operation(s) in the contract are not verified yet (listed at the end).`, '');
  lines.push('### Contract checks', '');
  lines.push('| Check | Result |', '|---|---|');
  lines.push(`| openapi.yaml is valid OpenAPI 3.0 and every $ref resolves | pass |`);
  lines.push(`| ${examples.checked} examples in openapi.yaml match their own schemas | ${mark(examples.problems.length === 0)} |`);
  lines.push(`| Reading data changed nothing (store snapshot before and after) | ${readOnlyProblem ? `**FAIL**: ${readOnlyProblem}` : 'pass'} |`);
  for (const problem of examples.problems) lines.push(`| (example problem) | ${problem.replace(/\|/g, '\\|')} |`);
  lines.push('', '### Requests sent', '');
  lines.push('| # | Operation | Case | Request | Expected | Got | Result |', '|---|---|---|---|---|---|---|');
  outcomes.forEach((o, i) => {
    const result = o.problems.length === 0 ? 'pass' : `**FAIL**: ${o.problems.join('; ').replace(/\|/g, '\\|')}`;
    lines.push(`| ${i + 1} | \`${o.case.operation}\` | ${o.case.label} | \`${o.case.url}\` | ${o.case.expectStatus} | ${o.status} | ${result} |`);
  });
  lines.push('', '### What each request is checked for', '');
  lines.push(
    '- the status is the one expected, and the contract documents it for that operation',
    '- the body is JSON and matches that status\'s schema: required fields present, no extra fields, types, enums, minimums',
    '- every `date-time` is ISO 8601 UTC with a `Z` and no milliseconds',
    '- case-specific rules: filtering, ordering, which ids appear, which message an error gives',
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
  const bare = await store.events.create({
    organiser_id: 'usr_1001', name: 'Verification fixture: an event with no roles yet', type: 'other',
    county: 'Kisumu', area: 'Milimani', venue: 'Fixture Hall', starts_at: new Date('2027-03-01T10:00:00Z'),
    ends_at: new Date('2027-03-01T12:00:00Z'), expected_guests: 10, status: 'upcoming',
  });
  const offer = await store.offers.create({
    role_id: 'rol_3001', event_id: 'evt_2001', workers_offered: 6, note: 'Verification fixture offer',
  });

  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  // 3. Every case.
  const before = await snapshot(store);
  const cases = buildCases({ bareEventId: bare.id, offerId: offer.id });
  const validators = new Map<string, ReturnType<Ajv['compile']>>();
  const outcomes: Outcome[] = [];
  for (const c of cases) outcomes.push(await runCase(c, base, contract, validators, ajv));
  const readOnlyProblem = (await snapshot(store)) === before ? undefined : 'a GET changed stored data';

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
    console.log(`${o.problems.length === 0 ? 'PASS' : 'FAIL'}  ${o.case.operation.padEnd(34)} ${o.case.label}  [${o.status}]`);
    for (const problem of o.problems) console.log(`      ${problem}`);
  }
  console.log(`contract: valid OpenAPI; examples: ${examples.checked} checked, ${examples.problems.length} problem(s)`);
  for (const problem of examples.problems) console.log(`      ${problem}`);
  if (readOnlyProblem) console.log(`FAIL  ${readOnlyProblem}`);
  if (unverified.length) console.log(`not yet verified: ${unverified.join(', ')}`);

  const reportFile = path.join(root, 'VERIFICATION.md');
  const existing = await fs.readFile(reportFile, 'utf8');
  const head = existing.split('\n## Latest run')[0].replace(/\n*Not generated yet\.\s*$/, '').trimEnd();
  await fs.writeFile(
    reportFile,
    `${head}\n\n${renderReport({ version: contract.info.version, examples, outcomes, unverified, readOnlyProblem })}`,
  );

  const failed = outcomes.filter((o) => o.problems.length > 0).length;
  const ok = failed === 0 && examples.problems.length === 0 && !readOnlyProblem;
  console.log(ok ? `\nAll ${outcomes.length} cases passed. VERIFICATION.md written.` : `\n${failed} case(s) failed. VERIFICATION.md written.`);
  return ok ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
