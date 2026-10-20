# ENDPOINT_LIST.md: Sherehe

Every endpoint traces back to a statement in API_NEEDS.md. Paths are nouns, verbs carry the action, ids sit in the path, filters in the query, and nothing nests more than one level below its parent resource.

## Endpoints Sherehe provides to Kazi Connect

| # | Method | Path | Purpose | Maps to Need |
|---|---|---|---|---|
| 1 | GET | `/api/events?status=upcoming&county={county}` | Lists upcoming events, optionally in one county | K1 |
| 2 | GET | `/api/events/{eventId}` | Returns one event | K1 |
| 3 | GET | `/api/events/{eventId}/roles` | Lists an event's staffing roles with category, headcount, shifts and pay | K2 |
| 4 | POST | `/api/offers` | Creates a staffing offer on a role, as pending | K3 |
| 5 | GET | `/api/offers/{offerId}` | Returns an offer and its status | K4 |
| 6 | DELETE | `/api/offers/{offerId}` | Withdraws a pending offer | K5 |

## Endpoints for the Sherehe website

| # | Method | Path | Purpose | Maps to Need |
|---|---|---|---|---|
| 7 | POST | `/api/auth/register` | Creates an organiser account and logs it in | O1 |
| 8 | POST | `/api/auth/login` | Logs in and returns a token | O1 |
| 9 | POST | `/api/auth/logout` | Logs out, so the token stops working | O1 |
| 10 | GET | `/api/me` | Returns the logged in organiser | O1 |
| 11 | POST | `/api/events` | Creates an event | O2 |
| 12 | POST | `/api/events/{eventId}/roles` | Adds a staffing role to an event | O2 |
| 13 | GET | `/api/events/{eventId}/offers` | Lists the offers on the organiser's event | O3 |
| 14 | PATCH | `/api/offers/{offerId}` | Accepts or declines an offer | O3, K4 |
| 15 | GET | `/api/training-options?category={category}&county={county}` | Lists Ujuzi courses for a role, read through Ujuzi | O4 (S1) |
| 16 | POST | `/api/crew-trainings` | Books crew training at Ujuzi | O4 (S3) |
| 17 | GET | `/api/crew-trainings` | Lists the organiser's crew trainings and their status | O4 (S4) |
| 18 | GET | `/api/crew-trainings/{trainingId}` | Returns one crew training and its status | O4 (S4) |
| 19 | PUT | `/api/crew-trainings/{trainingId}` | Replaces crew size and start date of a pending training | O4 (S5) |
| 20 | DELETE | `/api/crew-trainings/{trainingId}` | Cancels a pending training | O4 (S5) |
| 21 | POST | `/api/certificate-checks` | Checks a certificate number with Ujuzi and records the check | O5 (S2) |

Minimums from the Week 3 handout: 21 endpoints (at least 5) and 11 writes (at least 1).

## Notes on design choices

- `status=upcoming` is a query filter on `events`, not a separate path such as `/upcoming-events`.
- Offers are a top-level resource (`/api/offers`) rather than `/api/events/{eventId}/roles/{roleId}/offers`, which would nest two levels deep. The role is named in the request body instead.
- Accepting an offer is a `PATCH` of its status, so no verb such as `/accept` appears in a path.
- Endpoints 15 to 21 are Sherehe's own resources even though Ujuzi does the work. The website never calls Ujuzi directly, and partner keys never reach a browser.

## Peer review (Week 3, Part C)

Reviewed by: TODO (a team outside our ring; in a three-system ring that means outside Sherehe, Kazi Connect and Ujuzi)

| Reviewer comment | Row | Our response: fixed, or why we kept it |
|---|---|---|
| TODO | | |

The handout checks for visible revision: every comment is either fixed or answered in writing.
