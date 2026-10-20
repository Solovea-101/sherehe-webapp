# Sherehe API: Contract Verification

This file is written by `npm run verify` (`scripts/verifyContract.ts`). Do not edit it by hand.

The script starts the server with the in-memory store, sends real requests to every endpoint with good and bad input, and checks each real response against `openapi.yaml`: status code, exact field names, types, enums, date-time format, no extra fields and no missing fields. Every successful write is re-fetched with a GET to confirm the change, and every rejected write is checked to confirm nothing changed. Week 5 grades this as "evidence of systematic verification against the contract, not eyeballing".

Not generated yet.
