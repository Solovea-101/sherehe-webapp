# Sherehe API: Contract Verification

This file is written by `npm run verify` (`scripts/verifyContract.ts`). Do not edit it by hand.

The script starts the server with the in-memory store, sends real requests to every endpoint with good and bad input, and checks each real response against `openapi.yaml`: status code, exact field names, types, enums, date-time format, no extra fields and no missing fields. Every successful write is re-fetched with a GET to confirm the change, and every rejected write is checked to confirm nothing changed. Week 5 grades this as "evidence of systematic verification against the contract, not eyeballing".

## Latest run

Run on 2026-10-20T22:53:03Z against contract version 0.1.0.

**113 of 113 cases passed.** 0 operation(s) in the contract are not verified yet (listed at the end).

### Contract checks

| Check | Result |
|---|---|
| openapi.yaml is valid OpenAPI 3.0 and every $ref resolves | pass |
| 102 examples in openapi.yaml match their own schemas | pass |
| 93 reads and rejected writes changed nothing (store compared before and after each) | pass |

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
| 33 | `POST /api/events` | an organiser creates an event | `/api/events` | 201 | 201 | pass |
| 34 | `POST /api/events` | no login | `/api/events` | 401 | 401 | pass |
| 35 | `POST /api/events` | start date in the past | `/api/events` | 400 | 400 | pass |
| 36 | `POST /api/events` | county that does not exist | `/api/events` | 400 | 400 | pass |
| 37 | `POST /api/events` | tries to set the status | `/api/events` | 400 | 400 | pass |
| 38 | `POST /api/events` | guests sent as text | `/api/events` | 400 | 400 | pass |
| 39 | `POST /api/events/{eventId}/roles` | the organiser adds a role | `/api/events/evt_2009/roles` | 201 | 201 | pass |
| 40 | `POST /api/events/{eventId}/roles` | no login | `/api/events/evt_2009/roles` | 401 | 401 | pass |
| 41 | `POST /api/events/{eventId}/roles` | another organiser’s event | `/api/events/evt_2009/roles` | 403 | 403 | pass |
| 42 | `POST /api/events/{eventId}/roles` | a sample event nobody here owns | `/api/events/evt_2001/roles` | 403 | 403 | pass |
| 43 | `POST /api/events/{eventId}/roles` | unknown event | `/api/events/evt_9999/roles` | 404 | 404 | pass |
| 44 | `POST /api/events/{eventId}/roles` | headcount 0 | `/api/events/evt_2009/roles` | 400 | 400 | pass |
| 45 | `POST /api/events/{eventId}/roles` | tries to set filled | `/api/events/evt_2009/roles` | 400 | 400 | pass |
| 46 | `POST /api/events/{eventId}/roles` | category outside the shared list | `/api/events/evt_2009/roles` | 400 | 400 | pass |
| 47 | `POST /api/events/{eventId}/roles` | event is no longer upcoming | `/api/events/evt_2010/roles` | 409 | 409 | pass |
| 48 | `GET /api/events/{eventId}/offers` | an event with no offers yet | `/api/events/evt_2009/offers` | 200 | 200 | pass |
| 49 | `GET /api/events/{eventId}/offers` | no login | `/api/events/evt_2009/offers` | 401 | 401 | pass |
| 50 | `GET /api/events/{eventId}/offers` | another organiser’s event | `/api/events/evt_2009/offers` | 403 | 403 | pass |
| 51 | `GET /api/events/{eventId}/offers` | unknown event | `/api/events/evt_9999/offers` | 404 | 404 | pass |
| 52 | `POST /api/offers` | Kazi offers 3 of the 4 places | `/api/offers` | 201 | 201 | pass |
| 53 | `POST /api/offers` | a second pending offer on the same role | `/api/offers` | 409 | 409 | pass |
| 54 | `POST /api/offers` | unknown role | `/api/offers` | 404 | 404 | pass |
| 55 | `POST /api/offers` | a role on an event that is over | `/api/offers` | 409 | 409 | pass |
| 56 | `POST /api/offers` | a role with no places left | `/api/offers` | 409 | 409 | pass |
| 57 | `POST /api/offers` | more workers than open places | `/api/offers` | 400 | 400 | pass |
| 58 | `POST /api/offers` | zero workers | `/api/offers` | 400 | 400 | pass |
| 59 | `POST /api/offers` | workers sent as text | `/api/offers` | 400 | 400 | pass |
| 60 | `POST /api/offers` | tries to set the status | `/api/offers` | 400 | 400 | pass |
| 61 | `PATCH /api/offers/{offerId}` | no login | `/api/offers/ofr_4002` | 401 | 401 | pass |
| 62 | `PATCH /api/offers/{offerId}` | another organiser | `/api/offers/ofr_4002` | 403 | 403 | pass |
| 63 | `PATCH /api/offers/{offerId}` | unknown offer | `/api/offers/ofr_9999` | 404 | 404 | pass |
| 64 | `PATCH /api/offers/{offerId}` | status pending is not a decision | `/api/offers/ofr_4002` | 400 | 400 | pass |
| 65 | `PATCH /api/offers/{offerId}` | the organiser accepts: 3 places fill | `/api/offers/ofr_4002` | 200 | 200 | pass |
| 66 | `PATCH /api/offers/{offerId}` | deciding again: decisions are final | `/api/offers/ofr_4002` | 409 | 409 | pass |
| 67 | `POST /api/offers` | a new offer once the first was decided (1 place left) | `/api/offers` | 201 | 201 | pass |
| 68 | `DELETE /api/offers/{offerId}` | Kazi withdraws a pending offer | `/api/offers/ofr_4003` | 204 | 204 | pass |
| 69 | `DELETE /api/offers/{offerId}` | the same offer again | `/api/offers/ofr_4003` | 404 | 404 | pass |
| 70 | `DELETE /api/offers/{offerId}` | an accepted offer cannot be withdrawn | `/api/offers/ofr_4002` | 409 | 409 | pass |
| 71 | `DELETE /api/offers/{offerId}` | unknown offer | `/api/offers/ofr_9999` | 404 | 404 | pass |
| 72 | `POST /api/offers` | one more offer, to be declined | `/api/offers` | 201 | 201 | pass |
| 73 | `PATCH /api/offers/{offerId}` | the organiser declines: no places fill | `/api/offers/ofr_4004` | 200 | 200 | pass |
| 74 | `GET /api/training-options` | every course, in our own shape | `/api/training-options` | 200 | 200 | pass |
| 75 | `GET /api/training-options` | category and county filters, any letter case | `/api/training-options?category=security&county=NAIROBI` | 200 | 200 | pass |
| 76 | `GET /api/training-options` | nothing matches | `/api/training-options?category=plumbing` | 200 | 200 | pass |
| 77 | `GET /api/training-options` | category outside the shared list | `/api/training-options?category=baking` | 400 | 400 | pass |
| 78 | `GET /api/training-options` | no login | `/api/training-options` | 401 | 401 | pass |
| 79 | `GET /api/training-options` | Ujuzi is down: our own 502 | `/api/training-options?county=Mombasa` | 502 | 502 | pass |
| 80 | `POST /api/crew-trainings` | the organiser books crew training for their event | `/api/crew-trainings` | 201 | 201 | pass |
| 81 | `POST /api/crew-trainings` | no login | `/api/crew-trainings` | 401 | 401 | pass |
| 82 | `POST /api/crew-trainings` | crew of 41 | `/api/crew-trainings` | 400 | 400 | pass |
| 83 | `POST /api/crew-trainings` | training would start after the event | `/api/crew-trainings` | 400 | 400 | pass |
| 84 | `POST /api/crew-trainings` | tries to set the status | `/api/crew-trainings` | 400 | 400 | pass |
| 85 | `POST /api/crew-trainings` | unknown event | `/api/crew-trainings` | 404 | 404 | pass |
| 86 | `POST /api/crew-trainings` | another organiser’s event | `/api/crew-trainings` | 403 | 403 | pass |
| 87 | `POST /api/crew-trainings` | a course Ujuzi does not have | `/api/crew-trainings` | 404 | 404 | pass |
| 88 | `POST /api/crew-trainings` | Ujuzi is down: our own 502, nothing recorded | `/api/crew-trainings` | 502 | 502 | pass |
| 89 | `GET /api/crew-trainings` | the organiser’s own trainings | `/api/crew-trainings` | 200 | 200 | pass |
| 90 | `GET /api/crew-trainings` | another organiser sees none of them | `/api/crew-trainings` | 200 | 200 | pass |
| 91 | `GET /api/crew-trainings` | no login | `/api/crew-trainings` | 401 | 401 | pass |
| 92 | `GET /api/crew-trainings/{trainingId}` | one training | `/api/crew-trainings/trn_5001` | 200 | 200 | pass |
| 93 | `GET /api/crew-trainings/{trainingId}` | another organiser’s training | `/api/crew-trainings/trn_5001` | 403 | 403 | pass |
| 94 | `GET /api/crew-trainings/{trainingId}` | unknown training | `/api/crew-trainings/trn_9999` | 404 | 404 | pass |
| 95 | `PUT /api/crew-trainings/{trainingId}` | replace crew size and start | `/api/crew-trainings/trn_5001` | 200 | 200 | pass |
| 96 | `PUT /api/crew-trainings/{trainingId}` | the same body again gives the same result (idempotent) | `/api/crew-trainings/trn_5001` | 200 | 200 | pass |
| 97 | `PUT /api/crew-trainings/{trainingId}` | crew of 0 | `/api/crew-trainings/trn_5001` | 400 | 400 | pass |
| 98 | `PUT /api/crew-trainings/{trainingId}` | another organiser | `/api/crew-trainings/trn_5001` | 403 | 403 | pass |
| 99 | `PUT /api/crew-trainings/{trainingId}` | unknown training | `/api/crew-trainings/trn_9999` | 404 | 404 | pass |
| 100 | `PUT /api/crew-trainings/{trainingId}` | Ujuzi is down: our own 502, nothing changed | `/api/crew-trainings/trn_5001` | 502 | 502 | pass |
| 101 | `POST /api/crew-trainings` | a second booking, for the decision cases | `/api/crew-trainings` | 201 | 201 | pass |
| 102 | `PUT /api/crew-trainings/{trainingId}` | the centre decided first: 409, and our copy catches up | `/api/crew-trainings/trn_5002` | 409 | 409 | pass |
| 103 | `DELETE /api/crew-trainings/{trainingId}` | a decided training cannot be cancelled | `/api/crew-trainings/trn_5002` | 409 | 409 | pass |
| 104 | `DELETE /api/crew-trainings/{trainingId}` | another organiser | `/api/crew-trainings/trn_5001` | 403 | 403 | pass |
| 105 | `DELETE /api/crew-trainings/{trainingId}` | Ujuzi is down: our own 502, training kept | `/api/crew-trainings/trn_5001` | 502 | 502 | pass |
| 106 | `DELETE /api/crew-trainings/{trainingId}` | the organiser cancels a pending training | `/api/crew-trainings/trn_5001` | 204 | 204 | pass |
| 107 | `DELETE /api/crew-trainings/{trainingId}` | the same training again | `/api/crew-trainings/trn_5001` | 404 | 404 | pass |
| 108 | `POST /api/certificate-checks` | a valid certificate | `/api/certificate-checks` | 201 | 201 | pass |
| 109 | `POST /api/certificate-checks` | a revoked certificate is recorded with valid false | `/api/certificate-checks` | 201 | 201 | pass |
| 110 | `POST /api/certificate-checks` | a number Ujuzi does not know | `/api/certificate-checks` | 404 | 404 | pass |
| 111 | `POST /api/certificate-checks` | a number in the wrong format | `/api/certificate-checks` | 400 | 400 | pass |
| 112 | `POST /api/certificate-checks` | no login | `/api/certificate-checks` | 401 | 401 | pass |
| 113 | `POST /api/certificate-checks` | Ujuzi is down: our own 502, nothing recorded | `/api/certificate-checks` | 502 | 502 | pass |

### What each request is checked for

- the status is the one expected, and the contract documents it for that operation
- the body is JSON and matches that status's schema: required fields present, no extra fields, types, enums, minimums
- every `date-time` is ISO 8601 UTC with a `Z` and no milliseconds
- case-specific rules: filtering, ordering, which ids appear, which message an error gives
- a successful write is read back to confirm it stuck; a rejected write is checked to have changed nothing

### Not yet verified

Every operation in the contract has at least one case.
