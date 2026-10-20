# Sherehe API: Contract Verification

This file is written by `npm run verify` (`scripts/verifyContract.ts`). Do not edit it by hand.

The script starts the server with the in-memory store, sends real requests to every endpoint with good and bad input, and checks each real response against `openapi.yaml`: status code, exact field names, types, enums, date-time format, no extra fields and no missing fields. Every successful write is re-fetched with a GET to confirm the change, and every rejected write is checked to confirm nothing changed. Week 5 grades this as "evidence of systematic verification against the contract, not eyeballing".

## Latest run

Run on 2026-10-20T17:26:48Z against contract version 0.1.0.

**15 of 15 cases passed.** 3 operation(s) in the contract are not verified yet (listed at the end).

### Contract checks

| Check | Result |
|---|---|
| openapi.yaml is valid OpenAPI 3.0 and every $ref resolves | pass |
| 40 examples in openapi.yaml match their own schemas | pass |
| Reading data changed nothing (store snapshot before and after) | pass |

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

### What each request is checked for

- the status is the one expected, and the contract documents it for that operation
- the body is JSON and matches that status's schema: required fields present, no extra fields, types, enums, minimums
- every `date-time` is ISO 8601 UTC with a `Z` and no milliseconds
- case-specific rules: filtering, ordering, which ids appear, which message an error gives

### Not yet verified

These operations are in `openapi.yaml` but have no case yet. They are not implemented in this phase, so nothing is claimed about them.

- `POST /api/offers`
- `DELETE /api/offers/{offerId}`
- `PATCH /api/offers/{offerId}`
