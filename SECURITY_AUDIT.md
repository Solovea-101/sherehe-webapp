# Security audit (Week 9)

Written by the coding agent from what it ran and read on 2026-10-27, for the team to review. Everything marked **Tested** is a check in `__tests__/security.test.ts` or `__tests__/rateLimit.test.ts`, so it is repeated by every `npm test`. Items under **Decisions** are things the agent found but did not change, because they are design decisions.

## What was added this week

| Item | Where | Notes |
|---|---|---|
| API keys, one per consuming system, stored only as SHA-256 hashes | `lib/auth/partnerKey.ts`, `PARTNER_KEYS` (`name:hash`) | Added in Phase 5; named, fail-closed and tied to offers on 2026-10-28. A missing or wrong key answers 401 before anything else happens. |
| Rate limiting | `lib/rateLimit.ts`, called from `proxy.ts` | New. 100 requests a minute per partner key; everything else per address; 10 a minute for sign-up and login. 429 with `Retry-After` and `{ message, retryAfter }`. |
| `X-Content-Type-Options: nosniff` and `X-Frame-Options: DENY` on every response | `next.config.ts` | New, from the audit below. |
| 429 documented | `openapi.yaml`, README | The `RateLimited` response is on all 21 operations. `info.version` stays 0.1.0 because the contract has not been handed off. |

**Rate limit threshold and why.** The first figure was 100 requests a minute for each partner key, the handout's suggested default; it is now 300 for partners and 100 per address for everyone else (see Decisions, question 6, for why). [API_NEEDS.md](API_NEEDS.md) describes Kazi's use as reads on page loads (K1, K2), a poll every few minutes per pending offer (K4), and a few writes a day (K3, K5). That is far below 100 a minute, and a loop that runs without pausing would hit 100 within a second and be stopped. The number has **not** been measured against Kazi's real traffic; if Kazi's pages turn out to make more calls, raise `RATE_LIMIT_MAX` instead of changing code. Sign-up and login get 10 a minute per address because those are the two places a password can be guessed. A caller with an invented key is counted by address, so changing the key on every call does not buy a fresh allowance.

**Honest limits of the limiter.** The counts live in the server's memory. They restart when the server restarts, and they are not shared if two copies of the server run. Behind Render's proxy the address comes from the last `X-Forwarded-For` entry, which is only right when `TRUST_PROXY=true` is set there; without it every caller looks like the proxy and shares one allowance. Nothing here has been tried on Render.

## The Part D checklist

### Sensitive fields: does any response show a hash, a token, an internal id or an email it should not?

- **Looked at:** every mapper in `lib/mappers.ts` (each builds its answer from an explicit list of fields, never a raw row), then the actual answers of 12 endpoints, read as a partner and as an organiser, for forbidden key names at any depth, for any 64-character hex value, and for the organiser's own email.
- **Found:** nothing wrong. No answer contains `password`, `passwordHash`, `tokenHash`, `ujuziBookingId`, an owner id, or an email except the caller's own on the account endpoints. The account answers have exactly the fields `{ user: { id, email, name }, token, expiresAt }`, and carry `Cache-Control: no-store`. **Tested.**
- Stored secrets: passwords are scrypt hashes, session tokens and partner keys exist in storage only as SHA-256. **Tested** (the token is not found in the sessions table; its hash is).
- Login answers the same 401 for an unknown email and a wrong password. **Tested.**

### Other people's data: can a caller read or change someone else's records by changing an id?

- **Looked at:** every route that takes an id of something an organiser owns: an event's offers, adding a role, deciding an offer, and reading, changing or cancelling a crew training, and booking on an event.
- **Found:** nothing wrong. A second organiser gets 403 on all seven, nothing changes, and their own list of crew trainings never contains the owner's. **Tested.**
- Ids are guessable (`evt_2001`, `trn_5001`), which is fine only because every one of those routes checks ownership.
- Partner keys: offers are now filed under the consumer name, and another consumer's request for them answers 404 (see Decisions, question 2). **Tested.**

### Error messages: does any error reveal a stack, a path, a query or a table?

- **Looked at:** 8 hostile ids (SQL, path traversal, `%00`, a bare `%`, an emoji, 5,000 characters, HTML, a template string) sent to six routes, plus a broken JSON body, an array body, `null`, a 30 KB body, an unknown path, a wrong method, a 5,000-character token and a 5,000-character key.
- **Found:** nothing wrong. Every one answers a 4xx, JSON, with only a short `message` field and nothing from inside the server. **Tested.**
- An unexpected failure (the store throws an error full of host, path and SQL text) answers `500 { "message": "Something went wrong on our side. Please try again." }`; the detail goes only to the server log. **Tested.**
- A 429 from Ujuzi (Ujuzi 0.3.0 limits callers) becomes Sherehe's own 502 and none of Ujuzi's words reach our clients. **Tested.**
- Not checked: the exact errors of a real PostgreSQL going wrong. The in-memory store was used for these tests; the PostgreSQL store was only exercised by the store suite.

### Write endpoints: can an extra field be saved?

- **Looked at:** every write with a field it should not accept: `id`, `organiserId`, `organiser_id`, `status`, `isAdmin` and `createdAt` on events; `filled`, `id`, `eventId` on roles; `status`, `id`, `eventId` on offers; `workersOffered` on an offer decision; `isAdmin` and `id` on sign-up.
- **Found:** nothing wrong. Each one answers 400 and nothing is saved (a refused sign-up creates no account). **Tested.** `filled` on a role can only ever change by an organiser accepting an offer.

### Keys in the wrong place

- **Looked at:** tracked files, all branches' history, the README and every `console` call.
- **Found:** nothing wrong. The only env file ever committed is `.env.example`, with empty values. A search of the whole history for key-shaped text matches only obviously fake keys in three test files (`shk_…test-key…`) and one 64-character example inside Ujuzi's contract file. The README uses placeholders. No log statement prints a key, token or password; `scripts/issuePartnerKey.ts` prints a new key once on purpose, to be handed to the partner. Not checked: Render's settings, other machines, and the local ring's settings files (outside the repository).
- `npm audit --omit=dev` reported 0 vulnerabilities on 2026-10-27.

### Things beyond the handout that were looked at

- **Authentication on the website:** logout deletes the session on the server (**tested** in `auth.test.ts`); logins last 7 days.
- **Browser safety:** no `dangerouslySetInnerHTML`, `innerHTML` or `eval` anywhere in `app/`, `components/` or `lib/`. CORS allows any origin, which is safe here only because authentication is by header and never by cookie.
- **Headers:** `X-Powered-By` is off. **Found:** no `X-Content-Type-Options` on any answer. **Fixed:** `nosniff` and `X-Frame-Options: DENY` are now sent on every response. **Tested.**
- **Guessing keys and passwords:** before this week nothing limited it. **Fixed** by the rate limiter above. **Tested.**

## Does every endpoint require a key?

The rule Sherehe follows, agreed with Kazi Connect and Ujuzi on 2026-10-27: **every API endpoint needs a credential, except the ones you need to get one.** Three kinds:

- **System to system** (offers, K3 to K5): a partner key only. A request with no key or a wrong key gets 401. **Tested** in `partnerKey.test.ts`.
- **Endpoints a person's browser uses** (events, roles and offers for organisers, crew trainings, certificate checks): the organiser's login token. The three reads Kazi also uses (K1, K2) accept a key **or** a token, because a browser must never hold a partner key.
- **Open:** `POST /api/auth/register`, `POST /api/auth/login`, the website's pages, `/docs` and `/openapi.yaml`. There is no separate health-check endpoint.

The partner API **fails closed**: with no usable `PARTNER_KEYS` every key-only call is 401, in every environment, and the start-up log prints `Partner keys loaded: N (names)`, a count and names, never a key. The only way to open it is `ALLOW_OPEN_PARTNER_API=true`, which only the test suite sets and which is ignored when `NODE_ENV` is production. **Tested** (closed with no keys, with a raw key pasted, with an unnamed hash; open only with the switch and no key set up).

## Decisions (from the Week 9 questions, answered by Kazi Connect's and Ujuzi's agents on 2026-10-27)

| # | Question | Decision | Done |
|---|---|---|---|
| 1 | Keys versus login tokens, and open `/docs`, register and login | Acceptable. The rule above. Register and login keep their own per-address limit and answer the same for a wrong email and a wrong password. | Documented; no code change |
| 2 | Offers not owned by a key | Each offer is filed under the consumer **name** in `PARTNER_KEYS` (`name:hash`), not under the key's hash, so rotating a key does not hide offers. Another consumer's offer answers 404, the same as an unknown one. A role still has at most one pending offer, whoever made it. Existing offers were back-filled to `kazi`. | Done and **tested** (`partnerKey.test.ts`, migration 004) |
| 3 | Sign-up reveals whether an email has an account | Keep the 409 for now. A neutral answer only works with email verification, which neither system can send. The sign-up limit (10 a minute per address) makes it an accepted, known risk. Revisit when email verification exists. | Documented |
| 4 | Certificate holder name | Keep what Ujuzi sends (first name and one initial, such as "Achieng O."), show it only to the logged-in organiser, do not store it beyond the check's own record, do not log it, do not lengthen it. | Documented |
| 5 | `PARTNER_KEYS` unset leaves the API open | Fail closed always (see above), not only in production: `NODE_ENV` is a poor switch. | Done and **tested** |
| 6 | In-memory limiter | Acceptable for one server as a safety net against loops; it does not guard secrets. **The figure was wrong and was corrected on 2026-10-28:** Kazi said it normally makes under 10 calls a minute, but it refreshes its role list with one call per upcoming event and re-reads on a miss, which in the local ring (35 upcoming events) passed 100 a minute; Sherehe answered 429 and Kazi's list went stale. Partners now get 300 a minute (`RATE_LIMIT_PARTNER_MAX`); everyone else stays at 100 per address. When Ujuzi answers 429 our booking check waits for its `Retry-After` and carries on. | Done and **tested** (the limiter, the poller) |

Kazi's own figures behind decision 6 (they understated the refresh, see the table): one K4 request per pending offer every 3 minutes (every 10 s in the local ring), K1 and K2 about 14 calls per 5 minutes for 13 upcoming events, K3 and K5 one call per employer action. Only the ring's 10-second poll with more than about 16 pending offers at once could pass 100 a minute. Kazi treats a 429 as a failed call and does not read `Retry-After` yet.

Still open, and for the team: whether anything should replace the in-memory limiter before more than one copy of the server runs (a shared store such as Redis); and the certificate-holder privacy question beyond what Ujuzi's own contract returns.

## Evidence

- `evidence/week09/rate-limit-demo.txt`: a real run with the limit lowered to 3. A request with no key and one with a wrong key answered 401; after a minute five calls with a valid key answered `200 200 200 429 429`; the 429 carried `Retry-After` and the JSON body. The key in it is a placeholder.
- Tests: 16 in `rateLimit.test.ts` (counter, who is counted, over HTTP, login limit, a forged client-address header, off switch) and 23 in `security.test.ts`.
