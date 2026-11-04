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
| 2 | 2026-10-28 | Kazi Connect's role refresh was answered with 429 in the local ring | Our per-partner limit was 100 calls a minute, sized without Kazi Connect's pattern of one call for the event list plus one per upcoming event | Partner limit raised to 300 a minute, and `include=roles` added to the events list so the refresh is one call. Kazi Connect's agent asked for it and said it would adopt it | Ours (limit sizing). Fixed by us. Adopting `include=roles` is Kazi Connect's to do |
| 3 | 2026-10-28 | Kazi Connect treats our 429 as a failed call and does not read `Retry-After` | Their client does not use the header | Not fixed. Asked Kazi Connect on 2026-11-04 whether this changed, because Week 11 requires honouring `Retry-After`. Answer: TODO | Kazi Connect's. Fix: pending |
| 4 | 2026-11-03 | The second run of our seeding script created duplicates in all three systems: 3 Kazi Connect jobs, 15 Ujuzi applications (plus 3 more accepted), 8 Sherehe offers (plus 5 accepted and 3 declined) | The script's "already there?" checks looked at the wrong thing for those three kinds of record | Checks fixed (jobs read from the employer's own list, applications skipped when the graduate already has one, offers skipped when the role already has one). The duplicates that were already created are still in the local ring; cleaning them up deletes data, so it waits for the team's decision | Ours (the seed script, which is not committed). Script fixed by us; data cleanup open |
| 5 | 2026-11-04 | When a call to Ujuzi failed, our log only said "could not be reached". It could not tell "nothing is listening" from "wrong host name" | Our fetcher kept the error's name and dropped the system code behind it | The log line now ends with the short code, for example `(ECONNREFUSED)` or `(ENOTFOUND)`, and a timeout says how long we waited. Only a short upper-case code is kept, so no address or key can reach the log. Two new tests, one checked by breaking the code on purpose and seeing it fail | Ours. Fixed by us |
| 6 | 2026-11-04 | Part E asks us to watch for 401s and 404s from our downstream partner. We could not: our server log holds only our 429 lines (16 lines in all, 3 of them rate-limit lines caused by our own seeding), and nothing about ordinary requests | We log no requests at all | Week 12 adds one log line per request. Until then we cannot say whether Kazi Connect sent any 401 or 404 | Ours. Fix: pending (Week 12) |

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
| Partner stopped, then restarted (the real drill) | TODO. Ujuzi will start a new build on `:4013` and stop and restart it on our word. Run `npm run drill` while they do | TODO |

## Being a good provider (Part E)

Kazi Connect calls us. What we have checked so far:

- Our server log for the running ring (`logs/sherehe.log`) shows only 429 lines, and all three came from our own seeding script, not from Kazi Connect.
- That is all this log can show. It records no ordinary requests, so a 401 or a 404 from Kazi Connect would be invisible. That is row 6.
- Asked Kazi Connect on 2026-11-04 for any 400, 401, 404, 409 or 429 it has seen from us, with the handout's bug report. Answer: TODO.

## Cross-team

Real exchanges between the Sherehe, Ujuzi and Kazi Connect sessions on 2026-11-04. Each side's contact person: TODO.

- **Sherehe to Ujuzi:** sent the Part B results and asked for a stop and start window. Sent the one real bug we had found calling Ujuzi (row 1).
- **Ujuzi to Sherehe:** confirmed 0.4.0 is current and the `sherehe` key is the one issued to us. Said our Part B findings match what they see, and that they have seen no unexpected 401, 404 or 429 from our calls so far. Said they will not touch the ring's Ujuzi, so they will run a new build on `:4013` and stop and restart it when we say "go". Agreed that we will send a read-only burst of traffic when their logging is ready. Said they may propose two small additions (a stale-data header on job matches and `GET /api/stats`), and that they will tell us before anything is deployed. None of our calls S1 to S5 would change.
- **Sherehe to Kazi Connect:** asked what they have seen from us, whether they now honour `Retry-After`, and for a window to send us traffic in Week 12. Answer: TODO.

## Demo rehearsal

The three steps, run with `npm run drill` (it prints one line every two seconds):

1. The page shows live Ujuzi data: lines say `LIVE`.
2. Ujuzi stops: lines say `DEGRADED` with our friendly message, and the rest of the site keeps answering.
3. Ujuzi starts again: lines say `LIVE` again, with no change to our code.

Rehearsed against a stopped partner, locally, with a closed port (steps 1 and 2). The full three steps with a real stop and start: TODO.

## Not done yet

- A run against the live URLs (the colleagues' deployment). TODO.
- The real stop and start of Ujuzi, waiting on their `:4013` build.
- Kazi Connect's answers (rows 3 and 6).
- The instructor check-in slot and the human contacts.
