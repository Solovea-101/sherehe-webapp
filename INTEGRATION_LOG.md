# Integration Log: Sherehe (Week 10)

Our ring position: **Ujuzi** is upstream (we call it) and **Kazi Connect** is downstream (it calls us). The seam belongs to both teams, so every bug or surprise is listed here whoever's code it was in.

Where this was run: the three systems on one computer (the local ring: Sherehe `:4001`, Kazi Connect `:4002`, Ujuzi `:4003`, contract versions Sherehe 0.1.0, Kazi Connect 1.3.0, Ujuzi 0.4.0). The live Render versions are being set up by the team's colleagues, so nothing below was run against a live URL yet. Rows marked TODO need the humans or a partner.

## Preflight (Part A)

| Needed | State |
|---|---|
| Partner base URL and proof it is running | `http://localhost:4003` answered (Ujuzi, local ring). Live URL: TODO (colleagues) |
| The key they issued **to us** | Key named `sherehe`, held in our server settings as `UJUZI_API_KEY`. Ujuzi's session confirmed it is the only key issued, and the one for us |
| Their contract and README | `partner-tests/ujuzi_openapi.yaml`, version 0.4.0. Ujuzi's session confirmed 0.4.0 is still current (25 operations) |
| A live channel | Ujuzi's and Kazi Connect's sessions, by message (details under "Cross-team"). Human contacts on each side: TODO |
| A check-in slot | TODO (sign up on the shared sheet) |

## The first call, from a terminal (Part B)

Made outside our app, 2026-11-04, with the key read from the server settings and never printed:

```text
curl -i -H "X-API-Key: <our key>" "http://localhost:4003/api/courses?category=catering&county=Nairobi"
HTTP/1.1 200 OK   content-type: application/json
[{"id":"crs_501","title":"Food hygiene and event service","category":"catering",
  "centre":{"id":"cen_11","name":"Westlands Skills Centre"},"county":"Nairobi","area":"Westlands",
  "durationWeeks":2,"feeKes":3500,"nextStart":"2026-11-23T07:00:00Z","certificateLevel":"short-course"}, ...]
```

Result: it worked first time. Compared with the contract: status code, field names, types and nesting all match. The 17 courses returned by the unfiltered call all validate against Ujuzi's `Course` schema (checked with a schema validator, not by eye). Five normal calls took between 1.4 and 4.6 milliseconds, on the same computer.

## Bugs and surprises

One row per bug or surprise. "Whose code" is the team that owned the fault.

| # | When | What broke (symptom) | Root cause | Fix | Whose code, and who fixed it |
|---|---|---|---|---|---|
| 1 | 2026-10-27 | After adopting Ujuzi 0.2.0, 7 of 34 of our partner write tests failed | Our tests reused one event name for several bookings. Ujuzi's 0.1.1 rule says a second pending booking of the same course and event name is 409, so the 409s were correct | Each test booking got its own event name, a new test covers the 409, and our local stand-in for Ujuzi enforces the rule. Our `POST /api/crew-trainings` now answers its own 409 ("Ujuzi already has a pending booking of this course for this event") | Ours (the tests). Fixed by us |
| 2 | 2026-10-28 (late October, local ring; Kazi Connect has no exact time) | Kazi Connect's re-read of our roles was answered with 429 | Two causes together. Ours: the per-partner limit was 100 calls a minute, sized without Kazi Connect's pattern. Theirs: when an employer offered for a role newer than its 5-minute memory, each re-read cost 1 call for the event list plus 1 per upcoming event (about 36 calls), and it allowed 3 re-reads in a row, so it went over 100 a minute. Our log showed it at the time | Ours: partner limit raised to 300 a minute, and `include=roles` added to the events list so a re-read is one call. Theirs: re-reads limited to 2 in a row and then 1 a minute, a refused re-read now answers Kazi Connect's own 502 instead of a wrong 404, and Kazi Connect uses `include=roles` (account from Kazi Connect's session, 2026-11-04) | Both. Each side fixed its own part |
| 3 | 2026-10-28 | Kazi Connect treats our 429 as a failed call and does not read `Retry-After` | Their client does not use the header (confirmed by Kazi Connect's session on 2026-11-04) | Not fixed yet. It is on Kazi Connect's Week 11 list, with the numbers decided: GET only, at most 2 retries, 200 ms then 400 ms, on a 429 wait for `Retry-After` (capped at 5 seconds), 3 seconds per attempt when a person is waiting, and no retries in its background offer check. Being built on a local branch, nothing pushed | Kazi Connect's. Fix: in progress, theirs |
| 4 | 2026-11-03 | The second run of our seeding script created duplicates in all three systems: 3 Kazi Connect jobs, 15 Ujuzi applications (plus 3 more accepted), 8 Sherehe offers (plus 5 accepted and 3 declined) | The script's "already there?" checks looked at the wrong thing for those three kinds of record | Checks fixed (jobs read from the employer's own list, applications skipped when the graduate already has one, offers skipped when the role already has one). The duplicates that were already created are still in the local ring. **Decision (2026-11-10): leave them.** They are demo data and affect no test; deleting them means writing to Kazi Connect's and Ujuzi's databases, which belong to those teams, and cannot be undone. If the team wants a clean ring, the way is to re-create the three local databases empty and seed them once (a one-time step that needs the other teams' agreement) | Ours (the seed script, which is not committed). Script fixed by us; data cleanup open |
| 5 | 2026-11-04 | When a call to Ujuzi failed, our log only said "could not be reached". It could not tell "nothing is listening" from "wrong host name" | Our fetcher kept the error's name and dropped the system code behind it | The log line now ends with the short code, for example `(ECONNREFUSED)` or `(ENOTFOUND)`, and a timeout says how long we waited. Only a short upper-case code is kept, so no address or key can reach the log. Two new tests, one checked by breaking the code on purpose and seeing it fail | Ours. Fixed by us |
| 6 | 2026-11-04 | Part E asks us to watch for 401s and 404s from our downstream partner. We could not: our server log holds only our 429 lines (16 lines in all, 3 of them rate-limit lines caused by our own seeding), and nothing about ordinary requests | We log no requests at all | Week 12 adds one log line per request. Until then we cannot say whether Kazi Connect sent any 401 or 404 | Ours. Fix: pending (Week 12) |
| 7 | 2026-11-10 | During the Week 11 stop drill my drill script printed "LIVE" for about 20 s after 14:53:50Z while Ujuzi was still down | The script treated any HTTP 200 as live data. Sherehe now sends a saved copy as a 200 with `X-Data-Stale: true`, and the script did not look at that header. I saw it because the lines took about 612 ms and Ujuzi's port still refused connections | The script reads `X-Data-Stale` and `X-Data-As-Of` and prints SAVED, LIVE or DEGRADED. Recovery was then confirmed with the fixed script (LIVE from 14:54:30Z). Ujuzi's session was told the same day, with the corrected times | Ours (the drill script). Fixed by us |

## Tested on purpose

Nothing broke in these, so they are recorded as results. All on 2026-11-04, against Ujuzi 0.4.0 on the local ring, through a throwaway copy of Sherehe built from this branch (in-memory data, own port) so the running ring was not touched.

| Test | What we did | What happened |
|---|---|---|
| Wrong key, straight at Ujuzi | `curl -H "X-API-Key: wrong"` | 401 `{"message":"Send your partner key as X-API-Key, or log in and send Authorization: Bearer YOUR_TOKEN"}` |
| No key | `curl` with no header | The same 401 |
| Wrong key, through our app | A copy of Sherehe given a wrong `UJUZI_API_KEY`, then `GET /api/training-options` | The organiser gets **502** "Ujuzi is not responding right now. Try again in a minute." The log says `Ujuzi refused our API key (401)`. The user cannot tell this from an outage, on purpose; the log can |
| An id that does not exist | `GET /api/courses/crs_9999`, `GET /api/certificates/UJZ-0000-00000` | 404 `{"message":"Course crs_9999 not found"}` and 404 `{"message":"Certificate UJZ-0000-00000 not found"}` |
| Real data through our app | `GET /api/training-options?category=catering&county=Nairobi` as a registered organiser | 200 with 2 options. Every one validates against our own `TrainingOption` schema. Field names are the contract's, reshaped by our mapper (`id` becomes `courseId`, `centre.name` becomes `centreName`) |
| Field-shape check | Our client checks every field of every Ujuzi reply (type, allowed words, date format). Unit tests give it a stand-in that answers with a wrong shape, a non-JSON page, a redirect and a 500 | Each becomes our own 502, never a crash and never bad data on a page |
| Partner not running (nothing at the address) | Pointed `UJUZI_API_URL` at a closed port | **502**, the same friendly text, after 21 ms. Log: `Ujuzi could not be reached (ECONNREFUSED)`. `GET /api/events` and `GET /` still answered 200 |
| Partner address misspelled | Pointed `UJUZI_API_URL` at a host that does not exist | **502**, same text. Log: `Ujuzi could not be reached (ENOTFOUND)`. Other routes answered 200 |
| Key never reaches the browser | Fetched the home, training, certificates and new-event pages and every script they load (32 script downloads in all) from the running copy, and searched for the key. Also searched our code | 0 occurrences of the key. No browser-side file imports the Ujuzi client. No `NEXT_PUBLIC_` setting exists. Only `lib/clients/ujuziClient.ts` reads the key. Four server logs from these runs also hold 0 occurrences |
| Same question twice | `GET /api/training-options` for catering in Nairobi, twice in a row (2026-11-05, 14:24:11Z and 14:24:12Z) | The first took 53 ms, asked of Ujuzi. The second took 4 ms: our 5-minute memory answered it. This is why the drill below asks a different question every time; otherwise it would show remembered data, not Ujuzi's real state |
| **Partner stopped, then restarted (the real drill)**, 2026-11-05 | Ujuzi's session ran a new build on `:4013` (contract 0.4.0, in-memory data). My test copy of Sherehe, pointed at it, ran `npm run drill` (a different question every 2 seconds). On my word Ujuzi stopped it at 14:30:49Z and started it again, with no code change on either side | LIVE until 14:30:48Z. At 14:30:49Z, the second Ujuzi was stopped, the drill changed to **DEGRADED**: 29 lines in a row, each HTTP 502 with our friendly text, taking 3 to 41 ms. The log said `Ujuzi could not be reached (ECONNREFUSED)` each time. While it was down, `GET /`, `GET /api/me` and `GET /api/events` answered 200, and `POST /api/certificate-checks` answered our own 502. At 14:31:47Z the drill changed back to **LIVE** (HTTP 200, 49 ms). Ujuzi's session reported listening again as of 14:31:49Z, two seconds after my first live answer, which I read as the time it confirmed rather than the time it started. No code or setting was changed to recover |
| The same question after the memory expired | The fixed question warmed at 14:24:11Z was asked again during the stop, at 14:31:15Z | HTTP 502. Our memory had already expired (5 minutes), so it did not help. A question asked within 5 minutes of the stop would have been answered from memory. Not tried live today; Week 11 replaces that blind spot with a visible saved-data banner |

## Being a good provider (Part E)

Kazi Connect calls us. What we have checked so far:

- Our server log for the running ring (`logs/sherehe.log`) shows only 429 lines, and all three came from our own seeding script, not from Kazi Connect.
- That is all this log can show. It records no ordinary requests, so a 401 or a 404 from Kazi Connect would be invisible. That is row 6.
- Asked Kazi Connect on 2026-11-04 for any 400, 401, 404, 409 or 429 it has seen from us. Its session answered: the only incident was the 429 in row 2 (their re-reads, and our limit). It has seen no 400, 401, 404 or 409 from us and no shape that differs from our contract, and its 23-check end-to-end script against our server passes. This is Kazi Connect's own report; our log could not have confirmed it (row 6).

## Cross-team

Real exchanges between the Sherehe, Ujuzi and Kazi Connect sessions on 2026-11-04. Each side's contact person: TODO.

- **Sherehe to Ujuzi:** sent the Part B results and asked for a stop and start window. Sent the one real bug we had found calling Ujuzi (row 1).
- **Ujuzi to Sherehe:** confirmed 0.4.0 is current and the `sherehe` key is the one issued to us. Said our Part B findings match what they see, and that they have seen no unexpected 401, 404 or 429 from our calls so far. Said they will not touch the ring's Ujuzi, so they will run a new build on `:4013` and stop and restart it when we say "go". Agreed that we will send a read-only burst of traffic when their logging is ready. Said they may propose two small additions (a stale-data header on job matches and `GET /api/stats`), and that they will tell us before anything is deployed. None of our calls S1 to S5 would change.
- **Sherehe to Kazi Connect:** asked what they have seen from us, whether they now honour `Retry-After`, and for a window to send us traffic in Week 12. **Kazi Connect to Sherehe:** answered all four (rows 2 and 3 above). Agreed the wording of row 2 (both sides as the cause, both fixes). Agreed that Week 12 traffic (60 to 200 calls with their own key, about 300 ms apart) waits for our message with the URL of a test copy of Sherehe, and that their Week 11 stop drill uses a test copy of Sherehe on its own port, never the ring's Sherehe, and starts only on their word.
- **2026-11-05, after the computer restarted:** the ring and Ujuzi's `:4013` build were down. Ujuzi's session reported that our 100-call burst from the day before is in its request log, and that its in-memory `/stats` totals were lost with the process (the handout's own honest limit). It asked for a second burst once it restarts, so `/stats` holds both of us together, and then the stop and start drill. All three sessions have new names after the restart and were told what was agreed.
- **2026-11-10, the Week 11 drill, with Kazi Connect:** Kazi Connect's session ran its new retry and saved-data code against a test copy of Sherehe, which I stopped at 14:56:18Z and started at 14:56:38Z. It reported its saved list after 2 retries, its own 502 for a county it had never read, and live data again at 14:56:44Z with no change on its side (details in `RESILIENCE_NOTES.md`). It also asked us to wait for a message with the URL of a test copy before sending Week 12 traffic, which we agreed.
- **2026-11-10, the Week 11 drill, with Ujuzi:** Ujuzi's session ran its build on `:4013` and stopped it at 14:53:13Z and started it at 14:54:24Z (both reported). Our side is in `RESILIENCE_NOTES.md`, Part E. It also told us that its own contract file is now 0.5.0 on its branch (a new `GET /api/stats` and our two header names, documented). That is a note, not a hand-off: the team has not yet told our sub-team formally, and none of our calls S1 to S5 changed, so our copy stays at 0.4.0 until it is handed over.
- **2026-11-05, the second burst and the drill, with Ujuzi:** 100 read-only calls from 14:20:34Z to 14:23:48Z (87 with our key: 58 x 200, 19 x 404, 10 x 400, and 13 with no key x 401). Ujuzi's own final `/api/stats` before the stop showed 106 requests from our key and 0 server errors, and no 401 or 429 on our key at any time; the 19 above my 87 are my drill script's polling after the burst, which Ujuzi identified in its log. The stop at 14:30:49Z and the start (listening as of 14:31:49Z) are in the drill row. Ujuzi wrote both sides down. I first gave Ujuzi wrong drill figures (31 lines, 3 to 12 ms) and corrected them minutes later (29 lines, 3 to 41 ms) once I had computed them from the file. Ujuzi also agreed the stale-data header pair we will both use: `X-Data-Stale: true` and `X-Data-As-Of` (UTC, ending in Z, no milliseconds), only when the data is a saved copy.

## Demo rehearsal

The three steps, run with `npm run drill` (it prints one line every two seconds):

1. The page shows live Ujuzi data: lines say `LIVE`.
2. Ujuzi stops: lines say `DEGRADED` with our friendly message, and the rest of the site keeps answering.
3. Ujuzi starts again: lines say `LIVE` again, with no change to our code.

Rehearsed in full on 2026-11-05 against Ujuzi's `:4013` build, which its session stopped and restarted on our word (see "Tested on purpose"): LIVE, then DEGRADED for about a minute, then LIVE again, with no change to our code. Rehearsed earlier, on 2026-11-04, against a closed port (steps 1 and 2). Still to do: the same on the live URLs, once the colleagues' deployment is ready.

## Not done yet

- A run against the live URLs (the colleagues' deployment). TODO.
- Kazi Connect's answers (rows 3 and 6).
- The instructor check-in slot and the human contacts.
