# Resilience Notes: Sherehe (Week 11)

The feature: the organiser's "Train your crew" section and the Training page read Ujuzi's courses through Sherehe (`GET /api/training-options`). All the numbers below were measured on 2026-11-10, on one computer, against a stand-in Ujuzi that misbehaves on command (`npm run flaky`, `scripts/flakyUjuzi.ts`), in its own copy of the app. Nothing here was run against the live Ujuzi yet; those rows say TODO.

## Part A: the "before" pictures

Two copies of the same build ran side by side against the stand-in. Copy **A** was set to behave like Week 10 (`UJUZI_TIMEOUT_MS=10000`, `UJUZI_RETRIES=0`): one try, 10 s limit, no retries. Copy **B** used the Week 11 defaults. Every call asked a question never asked before, so the 5-minute memory could not answer it. One difference from Week 10 itself: A cannot show "no saved copy" as a Week 10 behaviour, but it never had one for the questions asked, so the picture is the same.

| What I did | Week 10 behaviour (A) |
|---|---|
| Normal: stand-in answering | 2 to 14 ms per call. (Real Ujuzi on this computer, Week 10: 1.4 to 4.6 ms) |
| Stand-in **slow** (answers after 12 s) | The page waited **10,014 ms**, then showed our 502 |
| Stand-in **flaky** (two calls in three fail with 503): 6 page loads | **4 of 6 page loads failed**, although a second try would have worked every time |

## Part B: the timeout

One try gives up after **2,500 ms** when a person is waiting (60,000 ms for the background booking check, unchanged). `AbortSignal.timeout` is passed inside the `fetch` options, so a slow partner is cut off at that time. The log says why: `Ujuzi did not answer in time (gave up after 2500 ms)`.

## Part C: the retries

`lib/clients/fetcher.ts`. The rules, with the test that holds each one in `__tests__/ujuziClient.test.ts`:

| Situation | Retry? |
|---|---|
| Timeout, or the connection fails (`ECONNREFUSED`, a dropped socket) | Yes |
| 500, 502, 503, 504 or any 5xx | Yes |
| 429 asking for 5 s or less | Yes, after waiting that long (`Retry-After`). A longer wait, or no `Retry-After`, is not retried: a person will not wait that long |
| 400, 401, 403, 404 | **No.** Asking again changes nothing. A refused key is logged, not retried |
| A write (booking, change, cancel) | **No.** It could be done twice |
| The background booking check | **No.** It asks again at its next round and already waits up to 60 s |

At most **2 retries** (3 tries in all), **200 ms** and then **400 ms** apart (doubling). Settings: `UJUZI_TIMEOUT_MS`, `UJUZI_RETRIES`, `UJUZI_RETRY_DELAY_MS`.

## Part D: the fallback

Order of what the user gets: live data; else **a saved copy of the last good answer, kept in memory, for up to an hour**, flagged with the headers `X-Data-Stale: true` and `X-Data-As-Of` (UTC) and shown with a notice on the page ("Showing the courses saved at Thu 5 Nov 2026, 17:24 EAT. Ujuzi is not responding right now, so this list may be out of date, and booking may not work until it is back."); else our friendly 502. Only the course list does this. A **certificate check never does**: a saved "valid" could be wrong, and a revocation must show at once, so it fails instead. The saved copy is gone when the server restarts. The log still records every failure, so a 401 from a wrong key is not hidden by the saved copy.

## Part F, item 1: what I tested

Copy **B** (Week 11 defaults) against the stand-in, 2026-11-10. "Reached the partner" is the number of calls the stand-in counted.

| Failure | What the user saw | What the log said | Reached the partner |
|---|---|---|---|
| Partner **stopped** (the question B had asked live 5 minutes earlier) | The saved list, in **613 ms**, flagged `X-Data-Stale: true`, `X-Data-As-Of: 2026-11-10T14:39:14Z` | `Ujuzi could not be reached (ECONNREFUSED); answering with the saved copy from 2026-11-10T14:39:14Z` | 0 (nothing was listening) |
| Partner **stopped**, a question never asked before | Our friendly 502 after **614 ms** | `Ujuzi could not be reached (ECONNREFUSED); attempt 1 of 3, trying again in 200 ms`, then `attempt 2 of 3, trying again in 400 ms`, then `Partner unavailable: ...` | 0 |
| Partner **slow** (12 s) | Our friendly 502 after **8,124 ms** (A: 10,014 ms) | `Ujuzi did not answer in time (gave up after 2500 ms); attempt 1 of 3, trying again in 200 ms`, and attempt 2 of 3 in 400 ms | 3 (A: 1) |
| Partner **flaky**, 6 page loads | **6 of 6 worked** (A: 2 of 6). The user never saw a failure | `Ujuzi failed with status 503; attempt 1 of 3, trying again in 200 ms` (12 such lines in all) | 18, exactly 3 for each page load (A: 6) |
| Partner **always 500** | Our friendly 502 after **609 ms** (A: 4 ms) | 2 retry lines, then the failure | exactly 3: two retries and then it stopped (A: 1) |
| Partner **rate-limited** (429, `Retry-After: 2`) | Our friendly 502 after **4,008 ms** (A: 4 ms) | `Ujuzi limited our requests (429); it asked us to wait 2 s; attempt 1 of 3, trying again in 2000 ms`, and attempt 2 of 3 | 3 (A: 1) |
| Partner **back** (stand-in started again, no change to the app) | The same question was live again, no headers | none | 1 |

No log line from either copy contained the key it was given. The real Ujuzi: TODO (Part E below).

## Part F, item 2: my numbers, and why

| Setting | Value | Why |
|---|---|---|
| Timeout, a try | **2,500 ms** | Measured normal answers took 2 to 14 ms from the stand-in and 1.4 to 4.6 ms from the real Ujuzi on this computer, so 2.5 s leaves a very wide margin for the internet and for Render. It is far below the 10 s a person waited before. Over the internet to a deployed Ujuzi I have not measured yet: TODO, and the number should be checked against it |
| Retries | **2** | The handout's cap. One more try rescued every flaky page load in the measurement |
| Delay | **200 ms, then 400 ms** | Short and doubling, so a struggling partner is not hit in a tight loop |
| Worst case before our own 502 | **(2 + 1) x 2,500 + 200 + 400 = 8,100 ms** | Measured: **8,124 ms** with the stand-in slow. With a 429 asking for 2 s the measured worst was 4,008 ms; a 429 asking for 5 s would take up to 10 s (two waits of 5 s), which is the one case above 8.1 s |

Is 8.1 s acceptable for this feature? It is the longest a person waits on a failing partner, and only when every try times out. The cost is that Ujuzi on Render's free tier, asleep, can take about a minute to wake, so the first organiser to open the section after a quiet spell will see the saved list or the friendly message rather than live courses. Our background booking check calls Ujuzi every 5 minutes, but only while some crew training is still pending, so it does not always keep Ujuzi awake. Not tested against a sleeping real Ujuzi: TODO.

## Part F, item 3: what a real user would experience without this code

DRAFT written by the coding agent from the measurements above, for the team to rewrite in its own words and check.

An organiser opens an event and scrolls to "Train your crew", or opens the Training page, to book a crew. Without this code the page showed "Loading courses from Ujuzi..." and waited up to 10 seconds with nothing to do, then showed an amber "Ujuzi is not available" card. If Ujuzi was only flaky, two page loads in three failed even though trying again a moment later would have worked, so the organiser had to press "Try again" by hand, over and over. A list they had been looking at two minutes before disappeared as soon as Ujuzi did not answer, and they could not even compare courses while they waited. With the code the same organiser sees the courses at once on a flaky day, sees the saved list with a notice and the time on a bad one, and sees the friendly message only when nothing was ever saved.

## Part F, item 4: what I did not build

A circuit breaker is a switch that stops calling a partner that has been failing for a while, and tests it occasionally. Ours still tries every request three times, up to 8.1 s, so while Ujuzi is down every organiser who opens the section waits that long before seeing the saved list or the message; a circuit breaker would answer from the saved copy at once and send only an occasional test call.

## Part E: the real partner

Ujuzi's session ran its build on `:4013` (the calls Sherehe makes, S1 to S5, unchanged) and stopped and restarted it on my word. My test copy of Sherehe used the Week 11 defaults. All times UTC, 2026-11-10; "reported" means Ujuzi's own report.

| Time | What happened | What Sherehe did |
|---|---|---|
| 14:47:39 | One question asked live (catering in Nairobi), then a drill asking a new question every 2 s | Live answers, 3 to 18 ms |
| 14:53:13 | Ujuzi stopped (reported), after the 5-minute memory had expired | |
| 14:53:14 | | The drill changed to **DEGRADED** for questions never seen before: our friendly 502, 14 lines in a row, each 610 to 620 ms (three refused tries with the 200 ms and 400 ms pauses between them) |
| 14:53:22 | I asked the 14:47:39 question again | **200 in 612 ms, a saved copy**, `X-Data-Stale: true`, `X-Data-As-Of: 2026-11-10T14:47:39Z`. Log: `Ujuzi could not be reached (ECONNREFUSED); answering with the saved copy from 2026-11-10T14:47:39Z` |
| 14:53:22 | A certificate check | **502** in 618 ms, never a saved copy. `GET /api/events` and `GET /` answered 200 |
| 14:53:34 | A question nobody had asked (plumbing in Wajir) | **502** in 609 ms, no stale header |
| 14:54:24 | Ujuzi listening again (reported), about 71 s down, no code change | |
| 14:54:30 | First confirmed live answer after it was back | **200, 5 ms, no stale header**. The same question that had been a saved copy was live again, with no change to our code |

Two things this showed. With a refused connection each failing page load took about 0.6 s, not 8.1 s: the 8.1 s worst case is for timeouts, where every try waits the full 2.5 s. And my drill script had a bug that this drill exposed, recorded in `INTEGRATION_LOG.md` (row 7): it printed any HTTP 200 as LIVE, so for about 20 s after 14:53:50 it showed saved copies as live data. It now prints SAVED, LIVE and DEGRADED. The recovery time above comes from the fixed script.

### The other direction: Kazi Connect's drill against a test copy of Sherehe

Kazi Connect is our consumer, so I was the partner that stopped. A separate test copy of Sherehe (port 4101, same build) was stopped at 14:56:18Z and started again at 14:56:38Z (about 20 s). Kazi Connect's account, in its own words and numbers: it read at 14:56:25Z and got **its saved list** (HTTP 200 in 0.63 s, 10 openings, its header `X-Data-Saved-At: 14:50:52Z`) after **2 retries** (ECONNREFUSED, 200 ms then 400 ms in its log); a county it had never read gave **its own 502** in 0.61 s; its jobs endpoint kept answering 200. At 14:56:44Z it read our restarted copy: every county answered 200 in 0.019 s with no `X-Data-Saved-At` header, so live, and it changed nothing on its side. Its counters for the drill: 4 retries, saved data served once. The Week 11 drill is complete from its side. Our log shows nothing about this yet: we log no requests until Week 12.

Still TODO: the drill on the live URLs, and a screenshot or recording of the saved-data notice with the partner stopped (the team).

## Checks

`npm run typecheck`, `npm test` and `npm run verify`: see the commit message of this phase for the counts. The stand-in is `npm run flaky`; `npm run drill` shows live, degraded and recovery lines.
