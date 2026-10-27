# Security audit (Week 9)

Written by the coding agent from what it ran and read on 2026-10-27, for the team to review. Everything marked **Tested** is a check in `__tests__/security.test.ts` or `__tests__/rateLimit.test.ts`, so it is repeated by every `npm test`. Items under **For the team to decide** are things the agent found but did not change, because they are design decisions.

## What was added this week

| Item | Where | Notes |
|---|---|---|
| API keys, one per consuming system, stored only as SHA-256 hashes | `lib/auth/partnerKey.ts`, `PARTNER_KEYS` | Added in Phase 5. A missing or wrong key answers 401 before anything else happens. |
| Rate limiting | `lib/rateLimit.ts`, called from `proxy.ts` | New. 100 requests a minute per partner key; everything else per address; 10 a minute for sign-up and login. 429 with `Retry-After` and `{ message, retryAfter }`. |
| `X-Content-Type-Options: nosniff` and `X-Frame-Options: DENY` on every response | `next.config.ts` | New, from the audit below. |
| 429 documented | `openapi.yaml`, README | The `RateLimited` response is on all 21 operations. `info.version` stays 0.1.0 because the contract has not been handed off. |

**Rate limit threshold and why.** 100 requests a minute for each partner key, which is the handout's suggested default. [API_NEEDS.md](API_NEEDS.md) describes Kazi's use as reads on page loads (K1, K2), a poll every few minutes per pending offer (K4), and a few writes a day (K3, K5). That is far below 100 a minute, and a loop that runs without pausing would hit 100 within a second and be stopped. The number has **not** been measured against Kazi's real traffic; if Kazi's pages turn out to make more calls, raise `RATE_LIMIT_MAX` instead of changing code. Sign-up and login get 10 a minute per address because those are the two places a password can be guessed. A caller with an invented key is counted by address, so changing the key on every call does not buy a fresh allowance.

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
- Not an issue today, but see "For the team to decide" below: partner keys do not own offers.

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

Not in the sense of the handout, and the team should decide whether that is acceptable (see below). What is true today:

- The partner endpoints (events, roles, offers: K1 to K6) require a key, or for the three read endpoints a logged-in organiser's token, because a browser must never hold a partner key. `POST/GET/DELETE /api/offers` accept only a key. A request with no key or a wrong key gets 401. **Tested** in `partnerKey.test.ts`.
- The organiser's own endpoints use a login token, not a key.
- Open to anyone: the website pages, `/docs`, `/openapi.yaml`, `POST /api/auth/register` and `POST /api/auth/login`. There is no separate health-check endpoint.
- **If `PARTNER_KEYS` is not set the partner endpoints are open** (with a warning in the log), so that a clean clone runs. A deployment must set `PARTNER_KEYS` and `REQUIRE_PARTNER_KEY=true`; the local ring does.

## For the team to decide (the agent changed none of these)

1. **The "every endpoint needs a key" rule.** Sherehe has two kinds of caller. If the rule must hold for the website's own endpoints and for `/docs` and `/openapi.yaml`, that needs a design (for example a public listing without partner-only fields, and a key-protected API). The agent did not invent one.
2. **Offers are not owned by a key.** Any issued partner key can read or withdraw any offer. With one partner (Kazi) that is harmless; once a second system gets a key, offers should record which key made them.
3. **Sign-up reveals whether an email has an account** (it answers 409 "An account with that email already exists"). It is the usual trade-off between a helpful message and privacy; the sign-up limit of 10 a minute slows anyone checking many addresses.
4. **Certificate checks show a holder's name.** Any logged-in organiser who knows a certificate number sees the name Ujuzi returns. That comes from Ujuzi's contract; whether it is acceptable is for the teams to agree.
5. **Production default for partner keys.** Making the key mandatory whenever `NODE_ENV=production`, instead of relying on `REQUIRE_PARTNER_KEY=true` being set, would stop a missing Render setting from opening the API.
6. **A shared rate-limit store** (Redis) if more than one copy of the server will ever run.

## Evidence

- `evidence/week09/rate-limit-demo.txt`: a real run with the limit lowered to 3. A request with no key and one with a wrong key answered 401; after a minute five calls with a valid key answered `200 200 200 429 429`; the 429 carried `Retry-After` and the JSON body. The key in it is a placeholder.
- Tests: 16 in `rateLimit.test.ts` (counter, who is counted, over HTTP, login limit, a forged client-address header, off switch) and 23 in `security.test.ts`.
