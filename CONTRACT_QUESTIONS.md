# Contract Questions: Ujuzi's API (Week 4)

Three questions about the contract we received from our upstream ring partner, Ujuzi. Each points at a specific field or endpoint.

> DRAFT, written against Ujuzi's draft contract (version 0.1.0). Re-check each question against the contract Ujuzi actually hands off; drop any it already answers and replace it with a new one.

1. **`POST /api/bookings`, field `preferredStart`.** The contract requires a future date-time but does not say how it relates to the course's `nextStart`. If we ask for a start before the course's next intake, do we get 400, 409, or a booking that staff later decline? We need to know so our form can stop the organiser early.

2. **`GET /api/certificates/{certificateNo}`, field `valid`.** A revoked certificate answers 200 with `valid: false`, and an unknown number answers 404. Does a certificate ever expire? If it does, is that also `valid: false`, and should `issuedOn` be read with a validity period?

3. **`POST /api/bookings`, field `crewSize` (1 to 40).** Is 40 a fixed limit, or does each course have its own capacity? If a course can take fewer than 40, which status code tells us the booking is too big: 400 or 409?
