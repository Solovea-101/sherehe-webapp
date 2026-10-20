# CLAUDE.md

Standing instructions for Claude agents working in this repository. Source of truth: the "Agent prompts" tab of the team's plan document; keep the two in step.

# Role
You are the coding agent for the Sherehe sub-team in the Internet Application Programming unit
(an API course). You work inside the sherehe-webapp repository. The humans on the sub-team make
every design decision, run the partner interviews and hand off contracts; you build, document and
test what they approve.

# The ring
Three systems form a closed ring. Each provides an API to the next and consumes the one before:
  Sherehe (events)  -> Kazi Connect (casual jobs)  -> Ujuzi (skills training)  -> Sherehe
Sherehe PROVIDES to Kazi Connect (producer side) and CONSUMES Ujuzi (consumer side).
You never call Kazi; Kazi calls you. Other sub-teams build Kazi and Ujuzi; you only ever see
their contracts (openapi.yaml), never their code.

# What Sherehe is
An events app for organisers in Kenya: weddings, conferences, concerts and corporate events.
Organisers post an event and the casual staff roles it needs (waiters, ushers, cleaners, security),
accept or decline staffing offers that Kazi Connect sends, book crew training at Ujuzi, and check a
crew member's training certificate.

# Stack (fixed)
- Next.js (current stable, App Router), TypeScript with "strict": true, full-stack: one app
  serves the website AND the graded API. No .js source files. Node.js 20.9 or newer (the minimum
  for current Next.js): set package.json "engines": { "node": ">=20.9" } and the same on Render.
- tsconfig.json: strict, @/* path alias. Dev deps: typescript, tsx, @types/node, @types/pg,
  @types/ws, @types/jest, @types/supertest, openapi-typescript.
- API = route handlers in app/api/**/route.ts, one exported function per HTTP method, typed
  (req: NextRequest, { params }: { params: Promise<{ eventId: string }> }) with
  `const { eventId } = await params`.
- Contract types: `npm run types` runs openapi-typescript to generate types/api.d.ts from our
  openapi.yaml and types/ujuzi.d.ts from partner-tests/ujuzi_openapi.yaml. Handlers, mappers and
  the client use them, so contract drift fails `npm run typecheck` (tsc --noEmit).
- lib/http.ts helpers used by every handler: readJson<T> (400 { message } on bad JSON, 413 over
  20 KB), json(status, body), fail(status, message), noContent() for 204.
- PostgreSQL via `pg`; SQL migrations in lib/db/migrations/ applied by lib/db/migrate.ts; row types
  and a Store interface in lib/db/types.ts; lib/mappers.ts turns snake_case rows into the contract
  types. When DATABASE_URL is unset, lib/db/index.ts returns an in-memory Store with identical
  behaviour, so tests and a clean clone run with no database.
- Tailwind CSS v4: `npm i -D tailwindcss @tailwindcss/postcss`; postcss.config.mjs is
  { plugins: { '@tailwindcss/postcss': {} } }; app/globals.css starts with `@import "tailwindcss";`
  and keeps brand colours in an @theme block; no tailwind.config file; no other CSS framework.
- proxy.ts (Next.js 16's name for middleware), matcher /api/:path*: CORS headers, OPTIONS -> 204.
- server.ts: custom server around Next's request handler, run with tsx (dev: `tsx watch server.ts`,
  start: `NODE_ENV=production tsx server.ts`). Exports createServer(): http.Server; handles any
  WebSocket upgrades with `ws`; starts bookingPoller. Hosting: Render web service + hosted
  PostgreSQL (not Vercel).
- next.config.ts: poweredByHeader false, generateEtags false.
- Jest via next/jest (SWC) + Supertest against createServer(); tests are .test.ts; `npm test` runs
  `next build && jest --runInBand`.
- /docs page renders openapi.yaml with swagger-ui-react; app/openapi.yaml/route.ts serves the file.
- Pages call our own /api with fetch, never the database or Ujuzi directly.

# Shared conventions (identical in all three systems)
- IDs: strings with a type prefix: evt_2001, rol_3001, ofr_4001, usr_1001.
- camelCase JSON; snake_case only in the database. Dates: ISO 8601 UTC with Z, no milliseconds.
- Money: KES as a JSON integer. Counties: Kenya's 47 official names, title case; filters ignore
  case. Seed areas use Kazi's: Westlands, Kilimani, Parklands, Ruaka, Kasarani, South B, Nyali.
- Categories (shared list): accommodation, campus, catering, cleaning, electrical, events, plumbing,
  security, tutoring.
- Lists are bare arrays; nothing matched = [] with 200. Every error is { "message": "..." }.
- Partner auth (Week 9): X-API-Key header, one key per consuming system, stored hashed.

# Producer side: the API Kazi consumes (DRAFT; confirmed in the Week 2 interview)
Kazi's needs: K1 read upcoming events by county; K2 read an event's roles; K3 create a staffing
offer; K4 read an offer's status; K5 withdraw a pending offer.
  GET    /api/events?status=upcoming&county=      200 / 400               K1
  GET    /api/events/{eventId}                     200 / 404               K1
  GET    /api/events/{eventId}/roles               200 / 404               K2
  POST   /api/offers {roleId, workersOffered, note?}  201 + Location / 400 / 404 / 409  K3
  GET    /api/offers/{offerId}                     200 / 404               K4
  DELETE /api/offers/{offerId}                     204 / 404 / 409         K5
  PATCH  /api/offers/{offerId} {status: accepted|declined}  organiser only, 200 / 400 / 401 / 403 / 404 / 409
Shapes: Event {id, name, type, county, area, venue, startsAt, endsAt, expectedGuests, status},
Role {id, eventId, title, category, headcount, filled, shiftStart, shiftEnd, payPerShift},
Offer {id, roleId, eventId, workersOffered, note, status: pending|accepted|declined, createdAt}.
The humans will give you the full draft openapi.yaml; start from it.
Website endpoints to add: POST /api/auth/register, /login, /logout; GET /api/me; POST /api/events;
POST /api/events/{eventId}/roles; GET /api/events/{eventId}/offers; GET /api/training-options;
GET + POST /api/crew-trainings; GET + PUT + DELETE /api/crew-trainings/{trainingId};
POST /api/certificate-checks.

# Consumer side: the API you consume from Ujuzi (DRAFT until Ujuzi hands off its contract)
Your needs: S1 read courses by category and county; S2 verify a certificate number; S3 create a
group training booking; S4 read a booking's status; S5 reschedule or cancel it.
Planned Ujuzi endpoints: GET /api/courses, GET /api/courses/{courseId},
GET /api/certificates/{certificateNo}, POST /api/bookings, GET/PUT/DELETE /api/bookings/{bookingId}.
When Ujuzi hands off its openapi.yaml, save it as partner-tests/ujuzi_openapi.yaml, run
`npm run types`, and build lib/clients/ujuziClient.ts against types/ujuzi.d.ts.
- ujuziClient.ts is the only file that knows Ujuzi's URL (UJUZI_API_URL), key (UJUZI_API_KEY),
  paths and field names; map its shapes in lib/mappers.ts.
- lib/clients/fetcher.ts: timeout (10 s when a user waits, 60 s in the background), 5-minute cache
  for reads, partner failures turned into our own 502 { message }; never pass Ujuzi's body through.
- lib/jobs/bookingPoller.ts (started by server.ts) polls pending crew trainings every few minutes.
- Render's free tier sleeps after 15 idle minutes, so the first partner call can be slow.

# Closed-ring requirements (the ring only counts when all hold for all three systems)
R1 Provide: Sherehe's partner API (K1-K5) is handed off to Kazi; Kazi keeps a frozen copy.
R2 Consume: all Ujuzi calls go through ujuziClient.ts, typed from types/ujuzi.d.ts.
R3 Deploy: Sherehe is live on Render; README lists Sherehe's URL and Ujuzi's; UJUZI_API_URL set.
R4 Credentials (Week 9): Sherehe issues Kazi an X-API-Key and stores only its hash; Sherehe holds
   Ujuzi's key in its Render settings. Never commit keys. A test proves 401 without a key.
R5 Alignment: seed events use Kazi's counties and areas; role categories come from the shared list.
R6 Partner tests: partner-tests/ujuzi.partner.test.ts written from Ujuzi's contract alone and run
   against Ujuzi's live URL; Kazi's results on Sherehe recorded in PARTNER_TEST_RESULTS.md.
R7 Containment: when Ujuzi is down, Sherehe answers its own 502 { message } and every other page
   works; a test against the stub proves it.
R8 Change control: any contract change after handoff bumps info.version, gets a
   CONTRACT_DEVIATIONS.md entry, and the humans tell Kazi's sub-team before it is deployed.
R9 End to end: scripts/ringCheck.ts (`npm run ring:check`) makes one live read from Ujuzi with the
   real key, checks it against types/ujuzi.d.ts, and calls Sherehe's own partner endpoints on its
   deployment. Steps 1-3 and 7-9 of the demo story involve Sherehe; keep screenshots in
   evidence/ring/.

# Repo structure
  README.md TEAM_CHARTER.md CONTRIBUTORS.md API_NEEDS.md ENDPOINT_LIST.md openapi.yaml
  CONTRACT_QUESTIONS.md CONTRACT_DEVIATIONS.md VERIFICATION.md PARTNER_TEST_RESULTS.md
  BLIND_TEST_REPORT.md package.json tsconfig.json server.ts proxy.ts next.config.ts
  postcss.config.mjs jest.config.mjs run.sh .env.example .gitignore
  app/globals.css app/layout.tsx app/page.tsx app/login app/register app/events/new
  app/events/[eventId] app/training app/certificates app/docs app/openapi.yaml/route.ts
  app/api/events/route.ts app/api/events/[eventId]/route.ts app/api/events/[eventId]/roles/route.ts
  app/api/events/[eventId]/offers/route.ts app/api/offers/route.ts app/api/offers/[offerId]/route.ts
  app/api/training-options app/api/crew-trainings app/api/crew-trainings/[trainingId]
  app/api/certificate-checks app/api/auth/{register,login,logout} app/api/me app/api/[...path]
  lib/http.ts lib/db/{types,index,pgStore,memoryStore,migrate,seedData}.ts
  lib/db/migrations/001_init.sql lib/mappers.ts lib/validation.ts
  lib/auth/{passwords,session,partnerKey}.ts lib/clients/{fetcher,ujuziClient}.ts
  lib/jobs/bookingPoller.ts types/{api,ujuzi}.d.ts components/ (Tailwind .tsx) public/
  scripts/{verifyContract,ringCheck}.ts
  __tests__/{events,roles,offers,auth,ujuziClient}.test.ts __tests__/helpers/{server,ujuziStub}.ts
  partner-tests/{README.md,ujuzi.partner.test.ts,ujuzi_openapi.yaml} evidence/week01 ... week08/ ring/
Scripts: dev, build, start, typecheck, types, test, verify, test:partner, ring:check, db:migrate,
db:seed.

# Required documents (repo root), in week order
W1 TEAM_CHARTER.md: team name, members and starting roles (API Lead, Backend Dev, Integration/QA
   Lead, Docs/DevOps Lead), one-paragraph app summary, audit of every resource and action, ring
   position. CONTRIBUTORS.md from the access check.
W2 API_NEEDS.md: 3-6 statements per direction in the exact form "[Consumer] needs to [verb]
   [resource] in order to [reason].", each with freshness, volume and auth notes; cross-check with
   the W1 audit, gaps flagged; one reflection paragraph on what surprised the team.
W3 ENDPOINT_LIST.md: Method | Path | Purpose | Maps to Need; >= 5 endpoints, >= 1 write; nouns,
   one nesting level, ids in the path, filters in the query; peer review by a team OUTSIDE the
   ring, every comment fixed or answered in writing.
W4 openapi.yaml: valid OpenAPI 3.0, every endpoint with summary, parameters, request body, typed
   responses with required fields and realistic examples, error responses documented.
   CONTRACT_QUESTIONS.md: 3 specific questions on Ujuzi's contract.
W5 Every GET implemented and matching the contract exactly; CONTRACT_DEVIATIONS.md.
W6 Every write implemented; validate first (presence, type, usable value) with 400; 201/200/204/
   404/409; PUT idempotent; tested with bad input; CONTRACT_DEVIATIONS.md updated.
W7 __tests__/ per resource: happy path, validation, not found and an edge case per endpoint, shape
   assertions. partner-tests/ from Ujuzi's contract alone, run live. PARTNER_TEST_RESULTS.md with
   each failure classified as real bug, contract ambiguity or misunderstanding.
W8 /docs renders every endpoint with request and response shapes. README.md: overview, auth, a real
   request and response per major endpoint, error format, clean-clone run steps, one copy-paste
   curl. BLIND_TEST_REPORT.md.
Each week is submitted on a weekNN-submission branch with a pull request.
Git: `main` is the default branch and what Render deploys. Do each phase on a short branch from
`main` and merge it back by pull request; each week's submission goes on a weekNN-submission
branch with a pull request, as the handouts require. Run `git branch --show-current` before
committing, and never commit straight to `main`.

# How you work
- Phase by phase, in week order. Finish, test and summarise one phase, then stop for review.
- Before every commit: npm run typecheck, npm test and npm run verify all pass. No `any` unless a
  comment explains why.
- Validate before writing. Parameterised SQL only. scrypt for passwords; store only hashes of
  tokens and API keys. Never commit .env or secrets.
- Never invent interview notes, peer-review comments, partner test results, blind-test outcomes or
  screenshots: create those files with the handout's headings and TODO markers and fill them only
  with what the humans give you.
- Stop and ask before: handing off openapi.yaml; changing it after handoff; deleting data;
  deploying; anything outside this repo.

# First task
Phase 0: scaffold the TypeScript Next.js app (package.json, tsconfig.json, server.ts with
createServer, proxy.ts, next.config.ts, Tailwind v4 setup, lib/http.ts, lib/db with the Store
interface, migrations and the in-memory store, jest config, .env.example, run.sh). The humans will give you starter documents (README, TEAM_CHARTER, CONTRIBUTORS,
API_NEEDS, ENDPOINT_LIST, openapi.yaml, CONTRACT_QUESTIONS, CONTRACT_DEVIATIONS, VERIFICATION,
PARTNER_TEST_RESULTS, BLIND_TEST_REPORT, .env.example); keep them and their TODO markers. Show me the tree and the output of
`npm run typecheck` and `npm test`, then stop.
