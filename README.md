# Sherehe API

Sherehe is a REST API and website for event organisers in Kenya. Organisers post events and the casual staff roles they need, with pay per shift. **Kazi Connect** reads those roles and offers student workers for them, and organisers accept or decline each offer. Sherehe in turn uses **Ujuzi** to book crew training and check training certificates. It is built with Next.js, TypeScript and PostgreSQL.

| What | Where |
|---|---|
| Live API | TODO: https://<sherehe>.onrender.com |
| Interactive docs (Swagger UI) | TODO: https://<sherehe>.onrender.com/docs |
| The contract | TODO: https://<sherehe>.onrender.com/openapi.yaml |
| Our upstream (Ujuzi) | TODO: Ujuzi's live URL |
| Our downstream (Kazi Connect) | https://kaziconnect1-1xmu.onrender.com |
| Errors waiting on the other systems | [HELD_ISSUES.md](HELD_ISSUES.md) |

> **Before your first request:** the API runs on a free server that sleeps after 15 minutes without visitors, so the first request after a quiet spell can take up to a minute. Wait for it.

> TODO before the Week 8 blind test: run every command below yourself against the live API, from a clean terminal exactly as written, and replace any reply that differs. The replies shown here are real, but they were captured on 2026-10-21 from a local copy (a partner key enforced, and the local stand-in `scripts/ujuziStub.ts` in place of Ujuzi, so the course and certificate data comes from the stand-in). The handout grades "README quickstart works when followed literally, by someone else".

## Quickstart: one command

```bash
curl -s -w "\nHTTP %{http_code}\n" -H "X-API-Key: YOUR_KEY" "https://<sherehe>.onrender.com/api/events?status=upcoming&county=Mombasa"
```

You get back a JSON list of upcoming events and `HTTP 200`. With no key, or a wrong one, you get `{"message":"Send your partner key as X-API-Key"}` and `HTTP 401`.

## Authentication

There are two kinds of caller, and each endpoint says which it accepts (the full list is in the interactive docs).

**Partner systems (Kazi Connect)** send `X-API-Key: YOUR_KEY` on every partner endpoint.

- Each consuming system gets its own key and a name (`kazi`). Sherehe stores only the key's SHA-256 hash, as `name:hash` in `PARTNER_KEYS`, never the key, so a leaked setting cannot be used to call us.
- The team issues a key with `npm run partner:key -- --name kazi`: it prints a new key once (give that to the partner over a secure channel) and the `name:hash` entry to put in Render's settings. Never put a key in git, in `.env` or in a chat.
- **Offers belong to the system that made them.** Kazi's offers are filed under `kazi`, and another key gets `404` (the same as for an offer that does not exist) when it reads or withdraws one. To rotate a key, list the new key under the same name next to the old one, switch the partner over, then remove the old entry; the offers stay visible throughout.
- TODO: how a tester gets a demo key.
- Without a key, or with a wrong one, every partner endpoint answers `401 {"message": "Send your partner key as X-API-Key"}` and changes nothing. **The partner API is closed until a key is set up**, in every environment: with no `PARTNER_KEYS` every key-only call is refused, and the start-up log says `Partner keys loaded: 0`. The log line `Partner keys loaded: N (kazi)` shows a count and names, never a key. (The test suite alone can switch this off with `ALLOW_OPEN_PARTNER_API=true`; that is ignored in production.)
- **Every API endpoint needs a credential, except the ones you need to get one.** System-to-system endpoints take a partner key; the endpoints the website's pages use take the organiser's login token; open are `POST /api/auth/register`, `POST /api/auth/login`, the pages, `/docs` and `/openapi.yaml`. A browser never holds a partner key: the pages call our API, and our server adds keys when it calls another system.

**Organisers (the website)** log in and send `Authorization: Bearer YOUR_TOKEN`. `POST /api/auth/register` or `POST /api/auth/login` returns the token; it works for seven days, or until `POST /api/auth/logout`.

| Endpoints | Who may call them |
|---|---|
| `GET /api/events`, `GET /api/events/{eventId}`, `GET /api/events/{eventId}/roles` | a partner key **or** a logged-in organiser (a browser must never hold a partner key) |
| `POST /api/offers`, `GET /api/offers/{offerId}`, `DELETE /api/offers/{offerId}` | a partner key only |
| `PATCH /api/offers/{offerId}`, everything under `/api/events/{eventId}/offers`, `/api/me`, `/api/training-options`, `/api/crew-trainings`, `/api/certificate-checks`, `POST /api/events`, `POST /api/events/{eventId}/roles` | a logged-in organiser (and, where it matters, the organiser of that event) |
| `POST /api/auth/register`, `POST /api/auth/login` | anyone |

### Events with their roles in one call

`GET /api/events?status=upcoming&include=roles` returns the same list as `GET /api/events?status=upcoming`, with each event also carrying its staffing `roles` (an empty array when it has none). One call then replaces the list plus one `GET /api/events/{eventId}/roles` per event, so a system that refreshes every upcoming event costs a constant two database queries instead of one per event. `county` works as before; any `include` other than `roles` is a `400`. Without `include` the answer is exactly what it always was.

```bash
curl -s -H "X-API-Key: <your-api-key>" "http://localhost:3000/api/events?status=upcoming&county=Nairobi&include=roles"
```

### Rate limit

Each partner (counted by its key's name) may make **300 requests a minute**. Everything else (the website, a missing or wrong key) is counted per address at **100 a minute**, and sign-up and login are limited to **10 a minute** per address, because that is where passwords get guessed. The count restarts after a minute. Over the limit you get `429`, the request is **not** carried out, and the answer says how long to wait:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 42
Content-Type: application/json

{ "message": "Too many requests. Wait a little and try again.", "retryAfter": 42 }
```

A well-behaved client waits `Retry-After` seconds and tries again. Our own booking check does this when Ujuzi answers 429: it pauses for the time Ujuzi asked and carries on, and only a person's own action answers our 502. The partner figure comes from measuring Kazi in the local ring: it refreshes its list of open roles with one call for the events and one for each upcoming event (36 calls with 35 events), re-reads when it misses a role, and polls each pending offer, which passed 100 a minute, got 429 and left Kazi's list stale. 300 leaves room for that; it still grows with the number of upcoming events, so a long-running deployment may need a higher figure or a single call that returns events with their roles. The counts live in the server's memory: they start again when it restarts and are not shared between copies of the server. A real call, with a placeholder key:

```bash
curl -i -H "X-API-Key: <your-api-key>" "http://localhost:3000/api/events?status=upcoming"
```

The settings are `RATE_LIMIT_PARTNER_MAX`, `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_MS` and `RATE_LIMIT_LOGIN_MAX` (below); `RATE_LIMIT_MAX=0` switches the limit off, which only the tests do. Behind Render's proxy also set `TRUST_PROXY=true` so callers are told apart by their real address. [SECURITY_AUDIT.md](SECURITY_AUDIT.md) records the review that went with this, and `evidence/week09/rate-limit-demo.txt` shows a real run with the limit lowered to 3.

## One example per major endpoint

These run in order against a fresh copy. `YOUR_KEY` is a partner key and `TOKEN` is the organiser token from step 6.

**1. List upcoming events** (K1, endpoint 1)

```bash
curl -s -H "X-API-Key: YOUR_KEY" "https://<sherehe>.onrender.com/api/events?status=upcoming&county=Mombasa"
```

```json
[
  {
    "id": "evt_2006",
    "name": "Amina and Juma wedding",
    "type": "wedding",
    "county": "Mombasa",
    "area": "Nyali",
    "venue": "Nyali Beach Pavilion",
    "startsAt": "2026-12-27T15:00:00Z",
    "endsAt": "2026-12-27T23:00:00Z",
    "expectedGuests": 220,
    "status": "upcoming"
  }
]
```

`county` is optional and any letter case works; `status=upcoming` is required. A county that does not exist is a `400`; a real county with no events is `200` and `[]`.

**2. An event's staffing roles** (K2, endpoint 3)

```bash
curl -s -H "X-API-Key: YOUR_KEY" https://<sherehe>.onrender.com/api/events/evt_2001/roles
```

```json
[
  {
    "id": "rol_3001",
    "eventId": "evt_2001",
    "title": "Waiters",
    "category": "catering",
    "headcount": 6,
    "filled": 0,
    "shiftStart": "2026-12-05T13:00:00Z",
    "shiftEnd": "2026-12-05T23:00:00Z",
    "payPerShift": 1500
  },
  {
    "id": "rol_3002",
    "eventId": "evt_2001",
    "title": "Ushers",
    "category": "events",
    "headcount": 4,
    "filled": 0,
    "shiftStart": "2026-12-05T13:30:00Z",
    "shiftEnd": "2026-12-05T22:30:00Z",
    "payPerShift": 1200
  }
]
```

**3. Offer workers for a role** (K3, endpoint 4): answers `201` with a `Location` header

```bash
curl -s -i -X POST https://<sherehe>.onrender.com/api/offers \
  -H "X-API-Key: YOUR_KEY" -H "Content-Type: application/json" \
  -d '{"roleId":"rol_3001","workersOffered":6,"note":"Six trained catering students"}'
```

```text
HTTP/1.1 201 Created
content-type: application/json
location: /api/offers/ofr_4001

{"id":"ofr_4001","roleId":"rol_3001","eventId":"evt_2001","workersOffered":6,"note":"Six trained catering students","status":"pending","createdAt":"2026-10-21T18:05:03Z"}
```

The role must exist (`404`), its event must still be upcoming (`409`), the role must have open places (`409 "... is full"`), the offer cannot be bigger than the open places (`400`), and a role takes one pending offer at a time (`409`):

```bash
curl -s -w "\nHTTP %{http_code}\n" -X POST https://<sherehe>.onrender.com/api/offers -H "X-API-Key: YOUR_KEY" -H "Content-Type: application/json" -d '{"roleId":"rol_3001","workersOffered":1}'
```

```text
{"message":"Role rol_3001 already has a pending offer; wait for the organiser to decide or withdraw it"}
HTTP 409
```

**4. Check an offer** (K4, endpoint 5) **and withdraw it** (K5, endpoint 6)

```bash
curl -s -H "X-API-Key: YOUR_KEY" https://<sherehe>.onrender.com/api/offers/ofr_4001
curl -s -w "HTTP %{http_code}\n" -X DELETE -H "X-API-Key: YOUR_KEY" https://<sherehe>.onrender.com/api/offers/ofr_4001
```

```json
{
  "id": "ofr_4001",
  "roleId": "rol_3001",
  "eventId": "evt_2001",
  "workersOffered": 6,
  "note": "Six trained catering students",
  "status": "pending",
  "createdAt": "2026-10-21T18:05:03Z"
}
```

The second command answers `HTTP 204` with no body. Only a pending offer can be withdrawn (an accepted or declined one is `409`), and afterwards a `GET` of it is `404`.

**5. Not found, and wrong input**

```bash
curl -s -w "\nHTTP %{http_code}\n" -H "X-API-Key: YOUR_KEY" https://<sherehe>.onrender.com/api/events/evt_9999
curl -s -w "\nHTTP %{http_code}\n" -H "X-API-Key: YOUR_KEY" "https://<sherehe>.onrender.com/api/events?status=upcoming&county=Narnia"
```

```text
{"message":"Event evt_9999 not found"}
HTTP 404
{"message":"county must be one of Kenya's 47 counties, for example Nairobi"}
HTTP 400
```

### The organiser's side (the website uses these)

**6. Create an account** (endpoint 7). The password is stored only as a salted scrypt hash.

```bash
curl -s -X POST https://<sherehe>.onrender.com/api/auth/register -H "Content-Type: application/json" \
  -d '{"email":"njeri@example.com","name":"Njeri Kamau","password":"correct horse battery"}'
```

```json
{
  "token": "I4CDNvnxHA77xE2mCT-ETAhzTlD-HTBdsVqLVM09AFM",
  "expiresAt": "2026-10-28T18:05:23Z",
  "user": { "id": "usr_1002", "email": "njeri@example.com", "name": "Njeri Kamau" }
}
```

**7. Log in** (endpoint 8) returns the same shape (`POST /api/auth/login` with `email` and `password`; a wrong password and an unknown email give the same `401`). **Who am I** (endpoint 10) and **log out** (endpoint 9):

```bash
curl -s -H "Authorization: Bearer TOKEN" https://<sherehe>.onrender.com/api/me
curl -s -w "HTTP %{http_code}\n" -X POST -H "Authorization: Bearer TOKEN" https://<sherehe>.onrender.com/api/auth/logout
```

```text
{"id":"usr_1002","email":"njeri@example.com","name":"Njeri Kamau"}
HTTP 204
```

**8. Post an event** (endpoint 11): `201` with a `Location` header. The county can be any letter case; times are UTC with a `Z` and no milliseconds, and the start must be in the future.

```bash
curl -s -i -X POST https://<sherehe>.onrender.com/api/events -H "Authorization: Bearer TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"Njeri and Kamau wedding","type":"wedding","county":"nairobi","area":"Kilimani","venue":"Kilimani Gardens","startsAt":"2027-01-16T14:00:00Z","endsAt":"2027-01-16T22:00:00Z","expectedGuests":200}'
```

```text
HTTP/1.1 201 Created
location: /api/events/evt_2008

{"id":"evt_2008","name":"Njeri and Kamau wedding","type":"wedding","county":"Nairobi","area":"Kilimani","venue":"Kilimani Gardens","startsAt":"2027-01-16T14:00:00Z","endsAt":"2027-01-16T22:00:00Z","expectedGuests":200,"status":"upcoming"}
```

**9. Add a staff role to your event** (endpoint 12). Only the organiser of the event may, and `filled` always starts at 0.

```bash
curl -s -X POST https://<sherehe>.onrender.com/api/events/evt_2008/roles -H "Authorization: Bearer TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"Security guards","category":"security","headcount":4,"shiftStart":"2027-01-16T12:00:00Z","shiftEnd":"2027-01-16T23:00:00Z","payPerShift":1800}'
```

```json
{
  "id": "rol_3012",
  "eventId": "evt_2008",
  "title": "Security guards",
  "category": "security",
  "headcount": 4,
  "filled": 0,
  "shiftStart": "2027-01-16T12:00:00Z",
  "shiftEnd": "2027-01-16T23:00:00Z",
  "payPerShift": 1800
}
```

**10. See the offers on your event** (endpoint 13) **and accept one** (endpoint 14). Kazi offered 3 of the 4 places (`ofr_4002`). Accepting fills those places; declining does not; decisions are final.

```bash
curl -s -H "Authorization: Bearer TOKEN" https://<sherehe>.onrender.com/api/events/evt_2008/offers
curl -s -X PATCH https://<sherehe>.onrender.com/api/offers/ofr_4002 -H "Authorization: Bearer TOKEN" -H "Content-Type: application/json" -d '{"status":"accepted"}'
```

```json
{
  "id": "ofr_4002",
  "roleId": "rol_3012",
  "eventId": "evt_2008",
  "workersOffered": 3,
  "note": "Three guards with security certificates",
  "status": "accepted",
  "createdAt": "2026-10-21T18:05:23Z"
}
```

The role now shows `"filled": 3` to Kazi, and deciding again is refused:

```text
{"message":"Offer ofr_4002 is already accepted; accepted and declined are final"}
HTTP 409
```

**11. Courses at Ujuzi** (endpoint 15), read through Ujuzi and remembered for five minutes. `category` and `county` are optional.

```bash
curl -s -H "Authorization: Bearer TOKEN" "https://<sherehe>.onrender.com/api/training-options?category=security&county=nairobi"
```

```json
[
  {
    "courseId": "crs_502",
    "title": "Event security basics",
    "category": "security",
    "centreName": "Parklands Training Hub",
    "county": "Nairobi",
    "area": "Parklands",
    "durationWeeks": 3,
    "feeKes": 4500,
    "nextStart": "2026-12-01T07:00:00Z",
    "certificateLevel": "short-course"
  }
]
```

**12. Book crew training** (endpoint 16, which books at Ujuzi), then **list** (17), **read one** (18), **change** (19, a `PUT` that replaces `crewSize` and `preferredStart`) or **cancel** (20, a `DELETE`) a pending booking. The training must start before the event.

```bash
curl -s -i -X POST https://<sherehe>.onrender.com/api/crew-trainings -H "Authorization: Bearer TOKEN" -H "Content-Type: application/json" \
  -d '{"eventId":"evt_2008","courseId":"crs_502","crewSize":3,"preferredStart":"2026-12-14T05:00:00Z"}'
```

```text
HTTP/1.1 201 Created
location: /api/crew-trainings/trn_5001

{"id":"trn_5001","eventId":"evt_2008","courseId":"crs_502","crewSize":3,"preferredStart":"2026-12-14T05:00:00Z","status":"pending","createdAt":"2026-10-21T18:05:23Z"}
```

A start after the event is refused: `{"message":"preferredStart must be before the event starts (2027-01-16T14:00:00Z)"}` with `HTTP 400`. The status moves from `pending` to `confirmed` or `declined` when Ujuzi's training centre decides; Sherehe checks every five minutes, and the list and read endpoints come from Sherehe's own database, so they work even while Ujuzi is down.

**13. Check a certificate** (endpoint 21), asked of Ujuzi right now and recorded:

```bash
curl -s -X POST https://<sherehe>.onrender.com/api/certificate-checks -H "Authorization: Bearer TOKEN" -H "Content-Type: application/json" -d '{"certificateNo":"UJZ-2026-00123"}'
```

```json
{
  "id": "chk_7001",
  "certificateNo": "UJZ-2026-00123",
  "valid": true,
  "courseTitle": "Food hygiene and event service",
  "level": "short-course",
  "issuedOn": "2026-08-14",
  "holder": "Achieng O.",
  "checkedAt": "2026-10-21T18:05:23Z"
}
```

A revoked certificate answers `201` with `"valid": false`; a number Ujuzi does not know is `404` and is not recorded.

## Error reference

Every failure answers with one field, `message`, in plain English, and nothing is changed:

```json
{ "message": "Event evt_9999 not found" }
```

| Code | Meaning | Example cause |
|---|---|---|
| 400 | The request is wrong | Missing field, wrong type, a field the contract does not have, a date in the past, `workersOffered` larger than the open places |
| 401 | No valid key or token | Missing or wrong `X-API-Key` on a partner endpoint; no login, or an expired one, on an organiser endpoint; a wrong password |
| 403 | Not allowed | Deciding an offer on, adding roles to, or reading the offers of another organiser's event |
| 404 | No such id | A mistyped id, a withdrawn offer, a path that does not exist |
| 405 | The method is not allowed here | `DELETE /api/events/evt_2001`. The `Allow` header lists what is |
| 409 | Not allowed in the current state | The role is full, a second pending offer on a role, withdrawing or re-deciding a decided offer, changing a booking the training centre has already decided |
| 413 | Body too large | More than 20 KB of JSON |
| 429 | Too many requests | Over the rate limit. The request was not carried out; wait `Retry-After` seconds (also `retryAfter` in the body) |
| 500 | Our bug | Never shows internal details; the cause is in the server log |
| 502 | Ujuzi could not be reached or gave an answer we cannot use | Ujuzi asleep, slow (over 10 s), refusing our key, or down. Only the endpoints that need Ujuzi are affected; try again in a minute |

## Run the API on your own computer

You need Node.js 20.9 or newer (Next.js requires it) and Git. Everything else installs with the project.

```text
git clone TODO-repo-url
cd sherehe-webapp
npm install
npm run build
npm start
```

Open http://localhost:3000 for the website, or http://localhost:3000/docs for the docs. With no settings, data is kept in memory and reset to the sample data on every restart, so no database is needed. The website works, but **the partner endpoints refuse every key until you make one** (the log says `Partner keys loaded: 0`):

```text
npm run partner:key -- --name kazi           # prints a new key once, and the entry to store
PARTNER_KEYS=<the entry> npm start           # now partner calls work with  X-API-Key: <the key>
```

To try training and certificates without the real Ujuzi, start the local stand-in in a second terminal and point Sherehe at it:

```text
npx tsx scripts/ujuziStub.ts                 # prints its URL
UJUZI_API_URL=<that URL> npm start
```

### Checks

```text
npm run typecheck      # the code agrees with the contract's generated types
npm test               # builds, then runs every test; needs no database and no Ujuzi
npm run verify         # sends real requests to every endpoint and checks each reply against openapi.yaml; writes VERIFICATION.md
npm run types          # regenerates types/ after openapi.yaml or Ujuzi's contract changes
npm run test:partner   # our tests of Ujuzi's API, from its contract alone (see partner-tests/README.md)
npm run ring:check     # one live read from Ujuzi and a check of our own deployment (see below)
npm run ring:e2e       # the whole story across Sherehe, Kazi Connect and Ujuzi on this computer (see below)
```

`npm run verify` needs Node 22.19 or newer (its OpenAPI library does); the API itself does not.

**With a real PostgreSQL.** Set `DATABASE_URL`; the tables and the sample data are created on first start (`SEED_SAMPLE_DATA=false` skips the sample data). `npm run db:migrate` and `npm run db:seed` do those steps by hand. To run the store tests, or the whole suite, against a throwaway database: `TEST_DATABASE_URL=postgres://... npm test` (add `USE_PG_FOR_API_TESTS=true` for the whole suite).

**The ring check.** `npm run ring:check` reads from Ujuzi with our real key, checks the answer against Ujuzi's contract and `types/ujuzi.d.ts`, calls Sherehe's own partner endpoints on its deployment, and checks that a call without a key is refused. It only reads. When a failure is the kind that means another system is not finished, it names the item in [HELD_ISSUES.md](HELD_ISSUES.md). `-- --save` keeps the report in `evidence/ring/` for real, non-local runs.

**The whole ring on one computer.** Before anything is deployed, the three systems run side by side, each with its own database:

| System | Port | Database |
|---|---|---|
| Sherehe | 4001 | `sherehe_ring` |
| Kazi Connect | 4002 | `kazi_ring` |
| Ujuzi | 4003 | `ujuzi_ring` |

One local PostgreSQL serves the three databases; each belongs to its own role, and that role cannot connect to the other two. The settings files, the keys and the start-up script live in a folder outside all three repositories and are not in git. Sherehe's file sets `PORT`, `DATABASE_URL`, `UJUZI_API_URL=http://localhost:4003` and `UJUZI_API_KEY`, `PARTNER_KEYS` (the hash of the key Kazi uses) and `REQUIRE_PARTNER_KEY=true`, so the key rules are the real ones. A quick `BOOKING_POLL_MS` makes the booking check show within seconds instead of minutes.

`npm run ring:e2e` then plays the story through the three public APIs, creating its own organiser, event, roles, offers and booking each time (nothing is mocked and it reads no other system's database):

1. An organiser registers on Sherehe and posts an event with three roles.
2. Kazi lists those roles (it read them from Sherehe with its partner key), and an employer on Kazi makes three offers.
3. The organiser accepts one (the role fills and Kazi opens a job), declines one (no job) and Kazi withdraws one (it disappears from Sherehe).
4. The organiser reads courses through Sherehe, checks a valid and a revoked certificate, and books a crew training. A staff member of the training centre confirms it on Ujuzi, and Sherehe's booking check shows `confirmed`.

Each step prints `PASS` or `FAIL`. A step that fails only because another system is not running or not finished is marked `waiting on`, with the item of [HELD_ISSUES.md](HELD_ISSUES.md). The exit code is `0` when everything passed, `2` when nothing failed but something is not ready, and `1` for a real failure. `-- --only=kazi` or `-- --only=ujuzi` runs one half. Kazi remembers the events it read from Sherehe for a few minutes, so a role added a moment ago can be missing from Kazi's openings list while offers on it already work; running the script again later shows that step passing.

### Settings (environment variables)

| Name | What it does |
|---|---|
| `PORT` | Port to listen on (default 3000) |
| `DATABASE_URL` | PostgreSQL. Empty means the in-memory store |
| `SEED_SAMPLE_DATA` | `false` leaves a new database empty |
| `PARTNER_KEYS` | The keys we issued, comma separated, each as `name:SHA-256-hash`. Empty means every partner call is refused |
| `ALLOW_OPEN_PARTNER_API` | Tests only. `true` lets partner calls through while no key is set. Ignored in production |
| `UJUZI_API_URL`, `UJUZI_API_KEY` | Our upstream, and our key at Ujuzi |
| `UJUZI_TIMEOUT_MS`, `BOOKING_POLL_MS` | Optional tuning of the Ujuzi timeouts and the booking check (default every five minutes) |
| `SHEREHE_URL`, `SHEREHE_PARTNER_KEY`, `SHEREHE_CHECK_EMAIL`, `SHEREHE_CHECK_PASSWORD` | Only for `npm run ring:check` |
| `KAZI_URL`, `KAZI_API_KEY`, `UJUZI_URL`, `KAZI_EMPLOYER_EMAIL`, `KAZI_EMPLOYER_PASSWORD`, `UJUZI_STAFF_EMAIL`, `UJUZI_STAFF_PASSWORD` | Only for `npm run ring:e2e`; the defaults are the local ring's ports and demo accounts |
| `RATE_LIMIT_PARTNER_MAX`, `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_LOGIN_MAX` | Requests per window for each partner (default 300), for everyone else per address (default 100), the window (default 60000 ms), and sign-ups plus logins per address (default 10). `RATE_LIMIT_MAX=0` turns the whole limit off |
| `TRUST_PROXY` | `true` on Render: the caller's address is the last entry of `X-Forwarded-For`, not the proxy's socket |
| `SESSION_SECRET` | Reserved. Logins are random tokens whose hashes are stored, so nothing reads it yet |

See `.env.example`. Real values live in Render's settings, never in git.

## More documents

`SECURITY_AUDIT.md`, `TEAM_CHARTER.md`, `API_NEEDS.md`, `ENDPOINT_LIST.md`, `openapi.yaml`, `CONTRACT_QUESTIONS.md`, `CONTRACT_DEVIATIONS.md`, `VERIFICATION.md`, `PARTNER_TEST_RESULTS.md`, `BLIND_TEST_REPORT.md`, `HELD_ISSUES.md`.
