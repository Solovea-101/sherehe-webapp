# Held issues: errors and codes put on pause

Some errors Sherehe can show today are expected, because Kazi Connect and Ujuzi are not finished yet: Ujuzi has no live URL, no key has been issued, Kazi has not called us. Chasing those now would mean "fixing" Sherehe for faults that are not in Sherehe.

So each such item is **held** here instead of debugged. When all three systems are built, run the standby agent (below). It re-checks every open item and sorts it into one of three outcomes:

| Outcome | Meaning |
|---|---|
| **Resolved** | It was only a missing component. The other side is built now and the check passes. Nothing to fix. |
| **Still waiting** | The component is still missing or still unreachable. Nothing to fix yet. |
| **Genuine** | The component is there and working, and the check still fails. This one is a real bug (or a real contract mismatch) to fix. |

Each item says what it waits on, how to re-check it, and exactly what would make it genuine. Items marked **genuine now** are not waiting on anyone; they are listed so they are not forgotten.

## The standby agent

`.claude/agents/held-issues-checker.md` defines an agent called **held-issues-checker**. It does nothing until you call it. When the other two systems are ready, tell Claude Code: *"run the held-issues-checker agent"*. It reads this file, runs each open item's re-check, and reports a table of Resolved / Still waiting / Genuine. It only reads and runs checks; it does not change code or this file. Applying its findings is a separate step you approve.

## Open items

Status as of the end of Phase 2. "Phase 3-5" items are added or closed as those phases land.

| # | What is held | Waiting on | Re-check | Genuine if |
|---|---|---|---|---|
| H1 | **Ujuzi's real contract.** `partner-tests/ujuzi_openapi.yaml` is still the starter's DRAFT 0.1.0. `lib/clients/ujuziClient.ts`, the mappers and the local stub (`__tests__/helpers/ujuziStub.ts`) were built from it. | Ujuzi handing off its `openapi.yaml` (Week 4). | Replace the file, then `npm run types && npm run typecheck && npm test && npm run verify`. | `typecheck` fails on a field or enum that exists in Ujuzi's real contract. That is drift in our client or mappers, not a missing component. |
| H2 | **No live Ujuzi call has ever been made.** Every Ujuzi-backed endpoint (training options, crew trainings, certificate checks, the poller) is tested only against the local stub. `.env.example` still says `https://ujuzi-TODO.onrender.com`. | Ujuzi deployed, its URL in `UJUZI_API_URL`. | `npm run ring:check` (Phase 5) and `npm run test:partner` (Phase 3) with the live URL. | Ujuzi answers (any 2xx or 4xx JSON) but our client rejects it as "does not match its contract", or a status the contract documents is treated as an outage. |
| H3 | **Our key at Ujuzi.** The client sends `X-API-Key` only when `UJUZI_API_KEY` is set. If Ujuzi enforces keys, calls without one come back 401, which Sherehe reports as its own 502 ("refused our API key" in the log). | Ujuzi issuing Sherehe a key (Week 9). | Set `UJUZI_API_KEY` in the environment, rerun H2's check. | A 401 persists with a key Ujuzi confirms it issued. |
| H4 | **Cold start of a sleeping Ujuzi.** Render's free tier sleeps after 15 idle minutes. The first training-options call waits at most 10 s, then answers our 502; the poller waits up to 60 s. | Nothing to build. It is expected. | Call training options, wait a minute, call again. | The 502 continues after Ujuzi is confirmed awake. |
| H5 | **A booking that vanishes at Ujuzi.** If Ujuzi answers 404 for a booking we hold, the poller logs it and leaves our row alone; `PUT` answers 409 "Ujuzi no longer has this booking". We do not yet know whether Ujuzi deletes declined bookings or only ones it cancels. | Ujuzi's real behaviour and contract. | Book, have Ujuzi's staff decline it, run the poller, look at the log and `GET /api/crew-trainings/{id}`. | Ujuzi documents that declined bookings stay readable, yet the poller reports them missing. |
| H6 | **Staff decisions on Ujuzi's side.** The centre confirming or declining a booking happens on Ujuzi's website. We only pick the result up by polling. | Ujuzi's staff flow. | Decide a real booking at Ujuzi, wait one poll interval (`BOOKING_POLL_MS`, default 5 min), read the training. | The status is still pending well after the poll and Ujuzi's `GET /api/bookings/{id}` shows it decided. |
| H7 | **Kazi has not called Sherehe yet.** `PARTNER_TEST_RESULTS.md` has no results from Kazi's side. Behaviours Kazi has not confirmed are listed in `CONTRACT_DEVIATIONS.md` (unknown county gives 400, roles lists full roles too, one pending offer per role). | Kazi Connect's tests and answers. | Run the partner tests Kazi writes against Sherehe's live URL and record them in `PARTNER_TEST_RESULTS.md`. | Kazi's test fails on behaviour the contract states plainly (a field, a status code). A failure on a rule only this file mentions is a contract ambiguity to settle with Kazi. |
| H8 | **Partner keys: not enforced yet.** Until Phase 5, the partner endpoints answer without an `X-API-Key`, although the contract documents a 401. | Phase 5, then the humans issuing Kazi a key. | After Phase 5: `npm test` has the 401 test (R4). | Kazi sends a key the team issued and still gets 401. |
| H9 | **Hosted PostgreSQL on Render.** `DATABASE_URL` is read, but nothing has run against Render's database (SSL settings, connection limits). | Phase 3, then a Render database. | Set `DATABASE_URL` and run `npm run db:migrate`, then `npm start`. | Migrations pass locally against PostgreSQL but fail on Render for a reason that is not connection or SSL settings. |

## Genuine now (not waiting on anyone)

| # | What | Where |
|---|---|---|
| G1 | The partner-tests README tells testers to set `UJUZI_URL`, but `.env.example`, the README and the code use `UJUZI_API_URL`. One of the two documents is wrong. | `partner-tests/README.md` |
| G2 | Ujuzi's draft contract writes `description: Per trainee, KES, example: 3500` as an unquoted inline value. YAML reads the comma as the end of the description, so `KES` becomes a stray empty key. Harmless today; worth telling Ujuzi's team. | `partner-tests/ujuzi_openapi.yaml`, Course.feeKes |

## Closed

Nothing yet.
