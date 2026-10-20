# Sherehe API: Partner Test Results (Week 7)

Our ring: **Ujuzi** is upstream of us and **Kazi Connect** is downstream. Only contracts were exchanged, never test files, and each side ran its tests against the other's live, running API.

## 1. What Kazi Connect's tests found in our API

- What we shared: `openapi.yaml` version TODO, and our live URL TODO.
- What they ran, and against which URL: TODO
- Result: TODO ("nothing failed, all passed" is a real and valid result)

| Failure | Classification (real bug / contract ambiguity / misunderstanding) | What we did |
|---|---|---|
| TODO | | |

## 2. What our tests found in Ujuzi's API

Our tests are in `partner-tests/ujuzi.partner.test.ts`, written only from Ujuzi's contract (frozen copy: `partner-tests/ujuzi_openapi.yaml`). Run them with `npm run test:partner`.

- Ujuzi's live URL used: TODO
- Result: TODO

| Failure | Classification | Raised with Ujuzi / outcome |
|---|---|---|
| TODO | | |

## 3. Our own suite

TODO: number of tests and the date they last passed in full (for example, `npm test`: N passed).
