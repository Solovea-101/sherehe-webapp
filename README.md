# Sherehe API

Sherehe is a REST API and website for event organisers in Kenya. Organisers post events and the casual staff roles they need, with pay per shift. **Kazi Connect** reads those roles and offers student workers for them, and organisers accept or decline each offer. Sherehe in turn uses **Ujuzi** to book crew training and check training certificates. It is built with Next.js, TypeScript and PostgreSQL.

| What | Where |
|---|---|
| Live API | TODO: https://<sherehe>.onrender.com |
| Interactive docs (Swagger UI) | TODO: https://<sherehe>.onrender.com/docs |
| The contract | TODO: https://<sherehe>.onrender.com/openapi.yaml |
| Our upstream (Ujuzi) | TODO: Ujuzi's live URL |
| Our downstream (Kazi Connect) | https://kaziconnect1-1xmu.onrender.com |

> **Before your first request:** the API runs on a free server that sleeps after 15 minutes without visitors, so the first request after a quiet spell can take up to a minute. Wait for it.

> TODO before the Week 8 blind test: replace every example below with the real reply from the live API, and run every command yourself from a clean terminal exactly as written. The handout grades "README quickstart works when followed literally, by someone else".

## Quickstart: one command

```bash
curl -s -w "\nHTTP %{http_code}\n" -H "X-API-Key: YOUR_KEY" "https://<sherehe>.onrender.com/api/events?status=upcoming&county=Nairobi"
```

You get back a JSON list of upcoming events and `HTTP 200`.

## Authentication

- **Partner systems** (Kazi Connect) send `X-API-Key: YOUR_KEY` on every partner endpoint. Keys are issued per system by the Sherehe team. TODO: how a tester gets a demo key.
- **Organisers** on the website log in with `POST /api/auth/login`, then send `Authorization: Bearer YOUR_TOKEN`.

## One example per major endpoint

**List upcoming events** (Endpoint 1, need K1)

```bash
curl -s -H "X-API-Key: YOUR_KEY" "https://<sherehe>.onrender.com/api/events?status=upcoming&county=Nairobi"
```

```json
[
  {
    "id": "evt_2001",
    "name": "Wanjiku and Otieno wedding",
    "type": "wedding",
    "county": "Nairobi",
    "area": "Westlands",
    "venue": "Sarit Expo Centre",
    "startsAt": "2026-12-05T14:00:00Z",
    "endsAt": "2026-12-05T22:00:00Z",
    "expectedGuests": 300,
    "status": "upcoming"
  }
]
```

**An event's staffing roles** (Endpoint 3, need K2)

```bash
curl -s -H "X-API-Key: YOUR_KEY" https://<sherehe>.onrender.com/api/events/evt_2001/roles
```

```json
[
  {
    "id": "rol_3001",
    "eventId": "evt_2001",
    "title": "Waiters",
    "category": "catering",
    "headcount": 6,
    "filled": 0,
    "shiftStart": "2026-12-05T13:00:00Z",
    "shiftEnd": "2026-12-05T23:00:00Z",
    "payPerShift": 1500
  }
]
```

**Offer workers for a role** (Endpoint 4, need K3): answers `201`

```bash
curl -s -X POST https://<sherehe>.onrender.com/api/offers \
  -H "X-API-Key: YOUR_KEY" -H "Content-Type: application/json" \
  -d '{"roleId":"rol_3001","workersOffered":6,"note":"Six trained catering students"}'
```

```json
{
  "id": "ofr_4001",
  "roleId": "rol_3001",
  "eventId": "evt_2001",
  "workersOffered": 6,
  "note": "Six trained catering students",
  "status": "pending",
  "createdAt": "2026-11-20T09:15:00Z"
}
```

**Check an offer** (Endpoint 5, need K4) and **withdraw it** (Endpoint 6, need K5)

```bash
curl -s -H "X-API-Key: YOUR_KEY" https://<sherehe>.onrender.com/api/offers/ofr_4001
curl -s -w "HTTP %{http_code}\n" -X DELETE -H "X-API-Key: YOUR_KEY" https://<sherehe>.onrender.com/api/offers/ofr_4001
```

The first answers the offer with its `status`; the second answers `HTTP 204` with no body.

TODO: add examples for the website endpoints (register, log in, create an event, accept an offer, book crew training, check a certificate).

## Error reference

Every failure answers with one field, `message`, in plain English, and nothing is changed:

```json
{ "message": "Event evt_9999 not found" }
```

| Code | Meaning | Example cause |
|---|---|---|
| 400 | The request is wrong | Missing field, wrong type, unknown field, a date in the past |
| 401 | No valid key or token | Missing `X-API-Key`, or an expired login |
| 403 | Not allowed | Deciding an offer on another organiser's event |
| 404 | No such id | A mistyped id, or a withdrawn offer |
| 409 | Not allowed in the current state | The role is full, a duplicate pending offer, withdrawing a decided offer |
| 413 | Body too large | More than 20 KB of JSON |
| 502 | Ujuzi could not be reached | Ujuzi asleep or down; try again in a minute |

## Run the API on your own computer

You need Node.js 20.9 or newer (Next.js requires it) and Git.

```text
git clone TODO-repo-url
cd sherehe-webapp
npm install
npm run build
npm start
```

Open http://localhost:3000/docs for the docs, or http://localhost:3000 for the website. With no settings, data is kept in memory and reset to sample data on every restart, so no database is needed.

To check everything works:

```text
npm run typecheck
npm test
npm run verify
```

Optional settings (environment variables): `DATABASE_URL` (PostgreSQL; tables and sample data are created on first start), `UJUZI_API_URL` and `UJUZI_API_KEY` (our upstream), `PARTNER_KEYS` (hashed keys we accept), `SESSION_SECRET`, `PORT` (default 3000). See `.env.example`.

## More documents

`TEAM_CHARTER.md`, `API_NEEDS.md`, `ENDPOINT_LIST.md`, `openapi.yaml`, `CONTRACT_QUESTIONS.md`, `CONTRACT_DEVIATIONS.md`, `VERIFICATION.md`, `PARTNER_TEST_RESULTS.md`, `BLIND_TEST_REPORT.md`.
