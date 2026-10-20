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

## Entry format

For each change:

**Endpoint N, `METHOD /path` (need)**
What changed: ...
Why the original did not hold up: ...
Flagged to Kazi Connect: date and how.
