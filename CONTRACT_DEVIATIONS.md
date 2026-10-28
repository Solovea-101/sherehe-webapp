# Sherehe API: Contract Deviations

Every change made to `openapi.yaml` after it is handed off to Kazi Connect in Week 4: what changed, and why the original did not hold up. Endpoint numbers match ENDPOINT_LIST.md. Every change that affects a client is flagged to Kazi Connect before it is deployed, and `info.version` goes up.

## Week 5: GET endpoints

No deviations yet. TODO: after implementing and verifying every GET, either list each change below or write "No deviations: every GET matched the contract as handed off." That is a valid, expected entry.

### Notes from the coding agent, for the team to turn into the entry above

`openapi.yaml` has not been changed and has not been handed off, so nothing below is a contract change yet. These are the places where the implemented GETs do something the contract text does not spell out, or do not yet do something it documents. `npm run verify` (see VERIFICATION.md) found every implemented GET matching the contract's response shapes.

- **401 is not returned yet.** The contract documents `security: partnerKey` and a `401` on endpoints 1, 2, 3 and 5. Partner keys are a Week 9 task (R4), so for now these GETs answer without an `X-API-Key`. Nothing in `openapi.yaml` needs to change when keys arrive, but Kazi should be told that today's behaviour is open.
- **Endpoint 1, an unknown county answers 400, not `[]`.** The contract says `county` is "one of Kenya's 47 counties" and documents a `400`, so `county=Narnia` is rejected. A real county with no events answers `200 []`. Matching ignores letter case only: `Trans Nzoia` is not accepted for `Trans-Nzoia`.
- **Endpoint 1, a blank `county=` means every county.** `?status=upcoming&county=` is the same as leaving `county` out.
- **Endpoint 1, `status` is exact and required.** Only `upcoming` is accepted, in lower case. `status` or `county` given twice is a `400`. Other query parameters are ignored.
- **Endpoint 3 lists every role of the event, including full ones.** Need K2 in API_NEEDS.md says "open" staffing roles, but the contract returns all roles with `headcount` and `filled`, so Kazi works out the open places as `headcount - filled`. Worth confirming that is what Kazi expects.
- **Not documented in the contract:** a request to a path that does not exist answers `404 { "message": "No endpoint GET /api/..." }`, and an unexpected server error answers `500 { "message": ... }`. Both keep the `{ message }` error shape.

## Week 6: write endpoints

TODO, same rule.

### Notes from the coding agent, for the team to turn into the entry above

As before, `openapi.yaml` has not been handed off, so none of this is a post-handoff change yet. Two kinds of note: places where a write does something the contract text does not spell out, and additions the agent drafted to the contract itself. `npm run verify` sends 113 real requests, including every write and its failures, and all match the contract's response shapes (see VERIFICATION.md).

**Partner endpoints Kazi uses (4, 6)**

- **Endpoint 4, `POST /api/offers`, the order of checks.** Body valid (400), role exists (404), its event is `upcoming` (409), the role has open places (409), the offer does not exceed them (400), the role has no other pending offer (409). The contract names the 400, 404 and 409 but not these causes; the messages reuse the contract's own examples ("Role rol_3001 is full", "workersOffered must be a whole number from 1 to the open slots").
- **Endpoint 4, "a duplicate pending offer" means a second pending offer on the same role.** The README lists it as a 409 cause without defining it. Kazi is the only offering partner, so Sherehe allows one pending offer per role at a time; once the organiser decides, or Kazi withdraws, the role can take a new one. Worth confirming with Kazi.
- **Endpoint 4, an offer larger than the open places is a `400`, not a `409`.** The message states the number open. A role with no places left is a `409` ("is full").
- **Endpoint 4, `note` is optional and trimmed.** Leaving it out stores `""`. `null` is refused (`note must be text`), as the contract types it `string`.
- **Endpoint 6, `DELETE /api/offers/{offerId}`.** Only a `pending` offer can be withdrawn; an accepted or declined one answers `409`. Afterwards the offer is gone and a `GET` answers `404`.
- **401 is still not returned on endpoints 1-6.** Same as the Week 5 note; partner keys are Phase 5 (Week 9).

**Organiser endpoints (7-14)**

- **Endpoint 14, `PATCH /api/offers/{offerId}`.** Accepting adds the offer's `workersOffered` to the role's `filled`; declining does not. Accepting is refused with `409` if it would put the role over its `headcount`. Deciding an offer on an event that is no longer `upcoming` is a `409`. Check order: logged in (401), offer exists (404), event is theirs (403), body valid (400), state allows it (409).
- **Endpoint 14 is the only way `filled` ever changes.** Nothing in the API lets an organiser or a partner set it.
- **The sample events cannot be decided by anyone.** They belong to a sample organiser account nobody can log in as, so a `PATCH` on an offer for a sample event answers `403` for every real organiser. Events organisers create themselves behave normally.
- **Endpoints 7-13 are drafted by the agent.** `openapi.yaml` now describes register, login, logout, `/api/me`, creating events and roles, and an event's offers. The shapes, limits (name 120 characters, headcount 1-1000, pay up to KES 100,000, guests up to 100,000, password 8-128 characters) and messages are the agent's proposal from `ENDPOINT_LIST.md`. **The team must review each one before handoff.**
- **A login lasts 7 days** and is sent as `Authorization: Bearer TOKEN`. Wrong password and unknown email give the same `401` answer.
- **Dates in requests are strict.** `YYYY-MM-DDTHH:mm:ssZ` only: no milliseconds, no offsets such as `+03:00`. Event and shift start times must be in the future.

**Ujuzi-backed endpoints (15-21), all drafted by the agent**

- **They need a login.** Training options, crew trainings and certificate checks all require an organiser token, so Sherehe's Ujuzi key is only ever spent for a logged-in organiser.
- **Endpoint 16, a training must start before its event.** `preferredStart` is refused if it is not before the event's `startsAt`, because the need (S3) is to have the crew trained before the event. The same rule applies to `PUT` (endpoint 19).
- **Endpoints 17 and 18 read Sherehe's own database,** not Ujuzi. The booking poller (every 5 minutes) keeps the status in step, so these keep working while Ujuzi is down. `GET /api/training-options` and the writes (16, 19, 20, 21) need Ujuzi and answer Sherehe's own `502 { message }` when it is unreachable, too slow (10 s), refuses our key, redirects, or sends an answer that does not match its contract.
- **Endpoint 15's answers are remembered for 5 minutes;** certificate checks (21) never are, so a revocation shows at once (S2 is "real time").
- **Endpoint 21 records every successful check,** including revoked certificates (`valid: false`). A number Ujuzi does not know is `404` and is not recorded.
- **Ujuzi's booking id is never shown.** Clients only see Sherehe's `trn_` id.
- **The agent built these against Ujuzi's DRAFT contract.** Nothing has been tried against a live Ujuzi. See HELD_ISSUES.md, items H1 to H6.

**Not documented in the contract**

- Any method a route does not support answers `405 { "message": ... }` with an `Allow` header. An unknown path answers `404 { "message": ... }`. An unexpected failure answers `500 { "message": ... }`. All three keep the `{ message }` error shape.

## Week 9: partner keys (R4)

No entry from the team yet. TODO, same rule.

### Notes from the coding agent, for the team to turn into the entry above

`openapi.yaml` has still not been handed off. What changed in Week 9, in the contract and in behaviour:

- **The 401 on endpoints 1-6 now exists.** The notes under Week 5 and Week 6 said it did not. A partner endpoint now answers `401 { "message": "Send your partner key as X-API-Key" }` (the contract's own example text) with a `WWW-Authenticate: ApiKey` header when the key is missing or wrong. The key check is the first thing that happens, so a stranger learns nothing from a 400 or 404.
- **Endpoints 1, 2 and 3 (the three reads) accept a partner key OR a logged-in organiser's token.** This is a change to `openapi.yaml`: their `security` now lists both `partnerKey` and `organiserToken`, with a description. The reason is the website: its home page and event pages read exactly these endpoints, and a partner key must never reach a browser. Endpoints 4, 5 and 6 (POST, GET and DELETE on offers) accept the partner key only.
- **Consequence for visitors:** once a deployment has partner keys, a person who is not logged in cannot browse events (the site shows "Log in to see the upcoming events"). Before keys are set the site is public. If the team wants public browsing even with keys on, that needs a separate, deliberate design (for example a public listing without partner-only fields); the agent did not invent one.
- **Keys are never stored.** Sherehe keeps only each key's SHA-256 (`PARTNER_KEYS`, comma separated). `npm run partner:key` prints a new key once and the hash to store. Several keys can be live at once, and removing a hash revokes that key.
- **If keys are not configured the endpoints stay open,** with a warning in the log, so a clean clone still runs. Set `REQUIRE_PARTNER_KEY=true` on the deployment to refuse everyone until a key exists. If `PARTNER_KEYS` contains entries that are not valid hashes (for example the raw key pasted by mistake), everything is refused instead, with a log line saying why.
- **Needs the humans:** issuing Kazi its key, setting `PARTNER_KEYS` and `REQUIRE_PARTNER_KEY=true` in Render, setting `UJUZI_API_KEY` there (once Ujuzi issues one), and telling Kazi's sub-team **before** this is deployed (R8): Kazi must start sending `X-API-Key` on endpoints 1-6.
- **`npm run ring:check` (R9)** is built. Its report was only ever run against local copies; the real run needs the live URLs and keys. See HELD_ISSUES.md, H2, H3 and H8.

## `include=roles` on the events list (2026-10-28)

Requested by Kazi Connect's agent, who said it will use it (1 call instead of 1+N) and keep the existing calls as a fallback. `openapi.yaml` has not been handed off, so `info.version` stays 0.1.0, but this is the change Kazi must be told about when it is.

- **Endpoint 1, `GET /api/events?status=upcoming[&county=][&include=roles]`.** New optional query parameter `include`; the only value is `roles`. With it every event also has a `roles` array of the same `Role` objects the roles endpoint returns. Without it, or with a blank value, the answer is exactly as before. Any other value, or `include` twice, is a `400`.
- **Additive:** no existing field, status code or behaviour changed, so a client that does not send `include` is not affected. The 200 response is documented as either shape (`Event[]` or `EventWithRoles[]`); the new schema is `EventWithRoles`.
- **Cost:** two database queries however many events there are (`roles.listByEvents`).
- **Checked:** typecheck; tests in `events.test.ts` (same events and the same roles as the separate calls, county filter, empty roles, 400s, no per-event queries); the new store method against the in-memory and a throwaway PostgreSQL store; `npm run verify`. The rate limit is unchanged and still counts each call.

## Partner key names, offer ownership, fail-closed keys (2026-10-28)

Agreed between Sherehe's agent, Kazi Connect's agent and Ujuzi's agent on 2026-10-27, from the Week 9 audit. `openapi.yaml` has still not been handed off, so `info.version` stays 0.1.0; this is the list Kazi must be told when it is.

- **Offers belong to the key that made them (endpoints 5 and 6).** Reading or withdrawing another system's offer now answers `404` with the usual wording, so nothing is given away. Kazi is the only partner and its behaviour is unchanged. Offers are bound to a stable consumer name, not to a key, so rotating Kazi's key does not hide its offers.
- **`PARTNER_KEYS` is `name:hash`.** The old bare-hash form is refused. Kazi's own settings do not change: it only sends its key.
- **The partner API fails closed.** With no usable key every call is `401`, in every environment. The earlier open mode and `REQUIRE_PARTNER_KEY` are gone; `ALLOW_OPEN_PARTNER_API=true` exists for the test suite and is ignored in production.
- **`429` on every operation** (300 requests a minute per partner, 100 per address for everyone else, 10 a minute for sign-up and login; the partner figure was raised from 100 on 2026-10-28 after Kazi's role refresh was limited in the local ring), with `Retry-After` and `{ message, retryAfter }`. Kazi does not read `Retry-After` yet; it treats a 429 as a failed call.
- **Our own use of Ujuzi's 429:** the booking check waits for Ujuzi's `Retry-After` and resumes; a person's action answers our 502.
- **Not changed, on purpose:** sign-up still says an account exists (409); certificate checks show the holder name exactly as Ujuzi sends it (first name and an initial). See SECURITY_AUDIT.md.
- **Flagged to Kazi Connect:** the three questions were put to its agent on 2026-10-27 and answered the same day (key-only offers, owner by name, fail closed). Telling its sub-team before deployment (R8) is still the humans' job.

## Ujuzi's contract moved to 0.4.0 (2026-10-28)

Same kind of change as the entry below: Sherehe's own `openapi.yaml` and its version are unchanged.

- **What changed:** `partner-tests/ujuzi_openapi.yaml` went from Ujuzi's 0.2.0 to its 0.4.0, copied from the file in Ujuzi's repository, which is byte for byte what Ujuzi serves at `/openapi.yaml`. `types/ujuzi.d.ts` was regenerated; `types/api.d.ts` was regenerated too and now includes the 404 wording added to the offer endpoints in the previous phase.
- **Approved by:** the team member driving the Sherehe session, who asked for the open points to be completed on 2026-10-28. Ujuzi's agent had announced the changes on 2026-10-27 and 2026-10-28.
- **Differences, read from the two files:** 429 (`TooManyRequests`, with `Retry-After`) on every operation, with the limits in the description (100 a minute per partner key, 120 per address for others, 10 sign-in attempts, and a 15-minute lock after five wrong passwords); bookings belong to the partner whose key made them, and another key gets 404; a note that a URL that does not accept the method answers 405 and broken percent-encoding answers 400; and one new website operation, `POST /api/auth/password` (Endpoint 25), which Sherehe does not use. The paths and shapes Sherehe calls (courses, certificates, bookings) are unchanged.
- **What Sherehe does about it:** nothing new in the client. A 429 from Ujuzi was already handled in the previous phase: a person's action answers our own 502, and the booking check waits for Ujuzi's `Retry-After`. Sherehe's key is named `sherehe` in Ujuzi's settings, so its bookings stay visible to it.
- **What was checked:** typecheck; the Ujuzi partner suite with writes against the local Ujuzi (33 passed, 1 todo); the full suite and `npm run verify` (see the commit). Not checked: Ujuzi's rule that another key's booking is 404, because Sherehe has only one key at Ujuzi.

## Ujuzi's contract adopted (2026-10-27)

This is a change to the contract Sherehe consumes, not to ours. `info.version` of Sherehe's own `openapi.yaml` is unchanged (0.1.0).

- **What changed:** `partner-tests/ujuzi_openapi.yaml` went from Ujuzi's draft 0.1.0 to Ujuzi's 0.2.0, copied from the file on Ujuzi's `main` (6bfa327), which Ujuzi also serves at `/openapi.yaml`. `types/ujuzi.d.ts` was regenerated with `npm run types`.
- **Approved by:** the team member driving the Sherehe session, on 2026-10-27 ("yes, adopt Ujuzi's 0.2.0"). Ujuzi's agent supplied the changelog below; Sherehe's agent only compared the paths.
- **Ujuzi's changelog since 0.1.0:** 0.1.1 documents a `413` (body over 20 KB) on POST/PUT/PATCH and writes down rules the API already followed (order of checks; a second pending booking for the same `courseId` and `eventName`, ignoring case, is `409`; `PUT` cannot change `eventName` or `courseId`; the accepted `preferredStart` forms). 0.2.0 adds 16 operations for Ujuzi's own website (accounts, enrolments, Kazi job matches and applications, staff tools) and lets `GET /api/courses`, `/api/courses/{id}` and `/api/certificates/{no}` accept a partner key or a login token. `Course`, `CertificateCheck`, `NewBooking`, `BookingUpdate`, `Booking` and `Error` are unchanged.
- **What Sherehe changed in response:**
  - The stand-in for Ujuzi used by the tests now enforces the duplicate-booking `409`.
  - The partner tests give each booking its own event name and have a new test for that `409`.
  - A second pending crew training of the same course for one event now answers `409 "Ujuzi already has a pending booking of this course for this event"`. The message used to say Ujuzi "cannot take this booking right now".
  - Four of our own tests booked the same course twice for one event; they now use different courses or names.
- **What was checked:** typecheck; 692 tests passed (1 skipped); `npm run verify` 123/123; the partner suite with writes against Ujuzi on `http://localhost:4003` (33 passed, 1 todo); `npm run ring:e2e` 22/22 before this change.
- **Not done:** nothing here was tried against a deployed Ujuzi. The agent has not classified the partner-test failures seen on the way (see PARTNER_TEST_RESULTS.md): the first run of the write tests against 0.2.0 failed 7 of 34 because our tests reused one event name, which the contract now rules out. That is the team's call to classify.

## Entry format

For each change:

**Endpoint N, `METHOD /path` (need)**
What changed: ...
Why the original did not hold up: ...
Flagged to Kazi Connect: date and how.
