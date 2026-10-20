# Sherehe API: Contract Verification

This file is written by `npm run verify` (`scripts/verifyContract.ts`). Do not edit it by hand.

The script starts the server with the in-memory store, sends real requests to every endpoint with good and bad input, and checks each real response against `openapi.yaml`: status code, exact field names, types, enums, date-time format, no extra fields and no missing fields. Every successful write is re-fetched with a GET to confirm the change, and every rejected write is checked to confirm nothing changed. Week 5 grades this as "evidence of systematic verification against the contract, not eyeballing".

## Latest run

Run on 2026-10-20T17:37:40Z against contract version 0.1.0.

**32 of 32 cases passed.** 13 operation(s) in the contract are not verified yet (listed at the end).

### Contract checks

| Check | Result |
|---|---|
| openapi.yaml is valid OpenAPI 3.0 and every $ref resolves | pass |
| 102 examples in openapi.yaml match their own schemas | pass |
| 28 reads and rejected writes changed nothing (store compared before and after each) | pass |

### Requests sent

| # | Operation | Case | Request | Expected | Got | Result |
|---|---|---|---|---|---|---|
| 1 | `GET /api/events` | upcoming events | `/api/events?status=upcoming` | 200 | 200 | pass |
| 2 | `GET /api/events` | county filter, lower case | `/api/events?status=upcoming&county=nairobi` | 200 | 200 | pass |
| 3 | `GET /api/events` | county filter, upper case | `/api/events?status=upcoming&county=MOMBASA` | 200 | 200 | pass |
| 4 | `GET /api/events` | real county with no events | `/api/events?status=upcoming&county=Turkana` | 200 | 200 | pass |
| 5 | `GET /api/events` | status missing | `/api/events` | 400 | 400 | pass |
| 6 | `GET /api/events` | status not upcoming | `/api/events?status=completed` | 400 | 400 | pass |
| 7 | `GET /api/events` | county is not a county | `/api/events?status=upcoming&county=Narnia` | 400 | 400 | pass |
| 8 | `GET /api/events/{eventId}` | an upcoming event | `/api/events/evt_2001` | 200 | 200 | pass |
| 9 | `GET /api/events/{eventId}` | an event that is over | `/api/events/evt_2007` | 200 | 200 | pass |
| 10 | `GET /api/events/{eventId}` | unknown id | `/api/events/evt_9999` | 404 | 404 | pass |
| 11 | `GET /api/events/{eventId}/roles` | an event with roles | `/api/events/evt_2001/roles` | 200 | 200 | pass |
| 12 | `GET /api/events/{eventId}/roles` | an event with no roles | `/api/events/evt_2008/roles` | 200 | 200 | pass |
| 13 | `GET /api/events/{eventId}/roles` | unknown event | `/api/events/evt_9999/roles` | 404 | 404 | pass |
| 14 | `GET /api/offers/{offerId}` | a pending offer | `/api/offers/ofr_4001` | 200 | 200 | pass |
| 15 | `GET /api/offers/{offerId}` | unknown id | `/api/offers/ofr_9999` | 404 | 404 | pass |
| 16 | `POST /api/auth/register` | a new organiser | `/api/auth/register` | 201 | 201 | pass |
| 17 | `POST /api/auth/register` | a second organiser | `/api/auth/register` | 201 | 201 | pass |
| 18 | `POST /api/auth/register` | email already taken (other letter case) | `/api/auth/register` | 409 | 409 | pass |
| 19 | `POST /api/auth/register` | email without @ | `/api/auth/register` | 400 | 400 | pass |
| 20 | `POST /api/auth/register` | password too short | `/api/auth/register` | 400 | 400 | pass |
| 21 | `POST /api/auth/register` | unknown field | `/api/auth/register` | 400 | 400 | pass |
| 22 | `POST /api/auth/register` | malformed JSON | `/api/auth/register` | 400 | 400 | pass |
| 23 | `POST /api/auth/login` | correct password | `/api/auth/login` | 200 | 200 | pass |
| 24 | `POST /api/auth/login` | wrong password | `/api/auth/login` | 401 | 401 | pass |
| 25 | `POST /api/auth/login` | unknown email gives the same answer | `/api/auth/login` | 401 | 401 | pass |
| 26 | `POST /api/auth/login` | password missing | `/api/auth/login` | 400 | 400 | pass |
| 27 | `GET /api/me` | the logged-in organiser | `/api/me` | 200 | 200 | pass |
| 28 | `GET /api/me` | no token | `/api/me` | 401 | 401 | pass |
| 29 | `GET /api/me` | a token that was never issued | `/api/me` | 401 | 401 | pass |
| 30 | `POST /api/auth/logout` | ends that login | `/api/auth/logout` | 204 | 204 | pass |
| 31 | `POST /api/auth/logout` | the same token again | `/api/auth/logout` | 401 | 401 | pass |
| 32 | `POST /api/auth/logout` | no token | `/api/auth/logout` | 401 | 401 | pass |

### What each request is checked for

- the status is the one expected, and the contract documents it for that operation
- the body is JSON and matches that status's schema: required fields present, no extra fields, types, enums, minimums
- every `date-time` is ISO 8601 UTC with a `Z` and no milliseconds
- case-specific rules: filtering, ordering, which ids appear, which message an error gives
- a successful write is read back to confirm it stuck; a rejected write is checked to have changed nothing

### Not yet verified

These operations are in `openapi.yaml` but have no case yet. They are not implemented in this phase, so nothing is claimed about them.

- `POST /api/events`
- `POST /api/events/{eventId}/roles`
- `GET /api/events/{eventId}/offers`
- `POST /api/offers`
- `DELETE /api/offers/{offerId}`
- `PATCH /api/offers/{offerId}`
- `GET /api/training-options`
- `GET /api/crew-trainings`
- `POST /api/crew-trainings`
- `GET /api/crew-trainings/{trainingId}`
- `PUT /api/crew-trainings/{trainingId}`
- `DELETE /api/crew-trainings/{trainingId}`
- `POST /api/certificate-checks`
