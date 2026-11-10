# Monitoring Notes: Sherehe (Week 12)

Everything measured here was run on 2026-11-10 on one computer, against a test copy of Sherehe built from this branch (in-memory data, request log on, two keys: `kazi` and my own test key `labs`). Nothing was run against a live URL yet; those rows say TODO. Paragraphs marked DRAFT are written by the coding agent from the numbers, for the team to rewrite and check.

## 1. Predictions (Part A)

The handout asks for these **before** any data. They are the team's to write, and the coding agent has not written them.

- Which endpoint do you think will be the slowest, and why? TODO (team)
- Which do you think will produce the most errors, and why? TODO (team)

## 2. What was recorded and how it was tested

- **The log:** one JSON line per finished request, registered first so a 401 or 429 is logged. Part B, three requests (my key, a wrong key, no key), real lines:

```text
{"time":"2026-11-10T15:03:53.465Z","method":"GET","path":"/api/events","status":200,"ms":23.4,"caller":"key-625662","partner":"labs"}
{"time":"2026-11-10T15:03:53.477Z","method":"GET","path":"/api/events","status":401,"ms":2.3,"caller":"none"}
{"time":"2026-11-10T15:03:53.485Z","method":"GET","path":"/api/events","status":401,"ms":1.4,"caller":"none"}
```

- **The key is not in the log:** `grep -c` for my real key printed **0**, and `grep -c` for its full SHA-256 also printed **0** (only the first 6 characters appear, in `caller`). Tests check the same for a key, a query string, a password, a request body and a login token.
- **`.env` and `requests.log`:** `.env` is ignored and `*.log` was added to `.gitignore`.
- **Traffic, mine:** `npm run traffic`, 120 read-only requests, 16:04:46Z to 16:04:53Z. Status codes received: 200 x57, 400 x10, 401 x20, 404 x33.
- **Traffic, my partner's:** Kazi Connect sent 120 requests with its own key to the same copy, 16:04:24Z to 16:05:01Z, about 300 ms apart. Its own count by status: 200 x47, 400 x19, 401 x11, 404 x43, no 429. **My log agrees exactly:** 109 lines for its key (caller `key-9c4450`, partner `kazi`): 47 x 200, 19 x 400, 43 x 404; average 3.5 ms, slowest 17.7 ms. Its 11 calls with no key are in my log as `none`, but that label is shared: in that window it holds 32 lines, all 401, which is Kazi's 11, my 20 (no key or a wrong key) and one keyless probe of `/api/stats`. It adds up only because I know my own numbers. **A keyless caller cannot be told apart in the log; this is by design** (we log no addresses and no keys), and a real limit.
- **`GET /api/stats`:** needs a key (401 without one, 405 for POST). After both runs: total 246, clientErrors 139, **serverErrors 0**, errorRatePercent 0, avgMs 3.6. The full output is in the README.

## 3. Reading my own data (Part E)

| Question | Where I looked | What it says |
|---|---|---|
| Which endpoint is slowest on average? | `avgMs` per route | `GET /api/events/:id/roles`, 4.1 ms. The others are 3.2 to 3.6 ms, so on average nothing stands out |
| Which has a slow worst case? | `maxMs` per route | The website home page, 29.4 ms (one request), `GET /api/events` 23.4 ms, `GET /api/events/:id/roles` 17.7 ms. Every other route's worst case is 7.1 ms or less |
| Which fails most often? | `clientErrors` and `serverErrors` | `GET /api/events/:id`: 36 of its 44 calls were 404, and all 29 `(no route)` calls were 404 or 401. **No 5xx anywhere**, so the error rate is 0%. The 4xx are my traffic scripts and Kazi's asking for ids and paths that do not exist on purpose, not mistakes found |
| Are the 401s a mistake or probing? | the lines with caller `none` | All 401s in these runs are known: my no-key and wrong-key calls, Kazi's 11 no-key calls, and my probes of `/api/stats`. In real use these lines are where to look for a partner with a wrong or missing key |
| Is the error rate healthy? | `errorRatePercent`, any 5xx | 0%, and no 5xx at all. Flat and healthy |

### Predicted against actual

TODO (team): compare your Part A predictions with the table above.

### One real pattern, with figures

The average hides it. Out of **247** logged requests the median was **3.5 ms** and only **3 took more than 10 ms**. Those three are each the *first* request of their kind after the server started: the home page (29.4 ms), the first `GET /api/events` (23.4 ms) and the first `GET /api/events/{id}/roles` (17.7 ms). Every other request on those routes was 8.2 ms or less, and the whole log's average (3.6 ms) is almost the same as its median. So `maxMs` per route shows warm-up, not a slow route.

### Why I think it happens, and what to check next (DRAFT)

My hypothesis, not yet tested: the first request of each kind pays for loading that route's code and warming the runtime, and later requests reuse it. To find out, I would restart the copy and compare the first call to the same route with the second and third, then send a warm-up request for each route at start-up and see whether the 29.4, 23.4 and 17.7 ms first calls disappear. On Render's free tier this also matters after every sleep, when the first user of each route would see this delay on top of the wake-up time.

### One alert I would want in production (DRAFT)

Pick **`errorRatePercent`** (5xx divided by total): alert when it is above **5% for 5 minutes** with at least 20 requests in that time, and tell the person on call. In this run it was 0%. For the Ujuzi side, also watch **`partners.ujuzi.unavailable`**: a rise means organisers are seeing our own 502. While a human is told and finds the cause, the Week 11 work is already doing its job for users: failed reads are retried up to twice, and the course list is served from a flagged saved copy for up to an hour, so the page shows saved data with a notice rather than an error.

## 4. What the numbers cannot tell you

They live in memory, so they start again at every restart and would be wrong across several copies of the server. A keyless caller cannot be told apart. The request that asks `/api/stats` is not in its own answer. The counts include my own test traffic and Kazi Connect's, which is the point of the exercise but not a picture of real use. The website's own files under `/_next/` are not counted.
