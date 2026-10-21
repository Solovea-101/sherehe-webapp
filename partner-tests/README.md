# Partner tests (Week 7)

Our tests against Ujuzi's API, written only from Ujuzi's contract (`ujuzi_openapi.yaml`, a frozen copy of the file Ujuzi handed off). We never see Ujuzi's code or test files.

Run them against Ujuzi's live server:

```bash
UJUZI_URL=https://ujuzi-TODO.onrender.com UJUZI_API_KEY=... npm run test:partner
```

Record every failure in `PARTNER_TEST_RESULTS.md`, classified as a real bug, a contract ambiguity or a misunderstanding.

## How the tests behave

- **The URL setting has two names.** `UJUZI_URL` (above) and `UJUZI_API_URL` (the name `.env.example`, the README and the app use) both work; `UJUZI_URL` wins if both are set. Without either, every test is skipped, so `npm run test:partner` never fails just because there is no Ujuzi yet.
- **Reads always run; writes are opt-in.** The tests for creating, changing and cancelling bookings write into Ujuzi's real system, so they only run with `PARTNER_TESTS_WRITE=true`. They name their bookings "Sherehe partner test (safe to delete)" and cancel them afterwards.

  ```bash
  UJUZI_URL=https://ujuzi-TODO.onrender.com UJUZI_API_KEY=... PARTNER_TESTS_WRITE=true npm run test:partner
  ```
- **Independent of our own code.** The test file imports nothing from `lib/`. It reads `ujuzi_openapi.yaml` and checks every response against it: status code, required fields, types, enums, dates in the ring's format (ISO 8601 UTC, a `Z`, no milliseconds).
- **Not covered:** the `409` answers for a booking the centre has already confirmed or declined, because only Ujuzi's staff can create that state. The test is marked `todo`; try it by hand with Ujuzi's team.
- **The first request can be slow.** A sleeping Render service takes up to a minute to wake, so each test is allowed 90 seconds.

## Trying the tests before Ujuzi exists

`npx tsx scripts/ujuziStub.ts` starts a local stand-in for Ujuzi built from the same draft contract and prints its URL (add `--key=abc` to make it demand an `X-API-Key`). Point the tests at it to see them pass. That shows the tests and the stand-in agree with the draft; it says nothing about the real Ujuzi.
