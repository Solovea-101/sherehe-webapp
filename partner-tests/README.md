# Partner tests (Week 7)

Our tests against Ujuzi's API, written only from Ujuzi's contract (`ujuzi_openapi.yaml`, a frozen copy of the file Ujuzi handed off). We never see Ujuzi's code or test files.

Run them against Ujuzi's live server:

```bash
UJUZI_URL=https://ujuzi-TODO.onrender.com UJUZI_API_KEY=... npm run test:partner
```

Record every failure in `PARTNER_TEST_RESULTS.md`, classified as a real bug, a contract ambiguity or a misunderstanding.
