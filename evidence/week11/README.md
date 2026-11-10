# Week 11 evidence: the fallback with the partner stopped

Real screenshots of the Training page, taken on **2026-11-10** by the coding agent with a headless browser. **They are from a local test copy of Sherehe pointed at a stand-in Ujuzi (`npm run flaky`), not from the live site and not from the real Ujuzi.** The team should add or replace them with its own screenshots from the live site when that is ready.

| File | When (UTC) | What it shows |
|---|---|---|
| `1-live.png` | 17:19:30 | Ujuzi answering. The course list is live and there is no notice |
| `2-saved-copy-notice.png` | 17:33:02 | The stand-in was stopped at 17:32:59, after the 5-minute memory had expired. The same list is a saved copy, and the page says so: "Showing the courses saved at Tue 10 Nov 2026, 20:19 EAT", with the reason underneath. 20:19 EAT is the 17:19 UTC of the first screenshot |
| `3-nothing-saved-friendly-message.png` | 17:33:06 | A question nothing was saved for (county Garissa). The page shows the friendly "Ujuzi is not available at the moment" card with a "Try again" button, and the rest of the page still works |

The first run of the capture script stalled while the computer was asleep, so the stop and the last two screenshots were done by hand a few minutes later, by the same steps. The saved copy was a genuine one: the first screenshot is what stored it.
