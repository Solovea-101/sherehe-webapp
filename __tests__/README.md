# Automated tests (Week 7)

One test file per resource: events, roles, offers, auth, and the Ujuzi client. Every endpoint is covered for the happy path, validation failures, not found and at least one edge case, and assertions check the response shape, not just the status code.

`helpers/server.ts` starts `createServer()` once; `helpers/ujuziStub.ts` is a tiny local Ujuzi built from the examples in `partner-tests/ujuzi_openapi.yaml`, so `npm test` never needs the live partner.

Run with: npm test
