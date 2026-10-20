# API Needs Statements: Sherehe

Format: *"[Consumer] needs to [verb] [resource] in order to [reason]."*

> DRAFT. These statements are the positions Sherehe takes into the Week 2 interviews. Rewrite each one with what Kazi Connect and Ujuzi actually say, then delete this note. Week 2 grades "statements reflect actual partner interview (not guessed)".

## Kazi Connect's needs from us (downstream)

| # | Statement | Freshness | Volume | Auth |
|---|---|---|---|---|
| K1 | Kazi Connect needs to read upcoming events in a county, with date and venue area, in order to show students where event work is coming up. | Within the hour | Every Event work page load | Partner key |
| K2 | Kazi Connect needs to read an event's open staffing roles, with category, headcount, shift times and pay per shift, in order to post matching jobs with accurate pay ranges. | Within the hour | Per event opened | Partner key |
| K3 | Kazi Connect needs to create a staffing offer on a role in order to tell the organiser that Kazi students can fill it. | Immediate | A few per day | Partner key |
| K4 | Kazi Connect needs to read a staffing offer's status in order to open the job to students only once the organiser accepts. | Within minutes | Polled every few minutes per pending offer | Partner key |
| K5 | Kazi Connect needs to withdraw a pending staffing offer in order to stop offering a role Kazi can no longer fill. | Immediate | Rare | Partner key |

## Our needs from Ujuzi (upstream)

| # | Statement | Freshness | Volume | Auth |
|---|---|---|---|---|
| S1 | Sherehe needs to read short courses by category and county, with duration, fee and next start date, in order to show organisers which training fits each crew role. | Daily | Per role page | Partner key |
| S2 | Sherehe needs to verify a certificate number in order to confirm a crew member finished a course before the organiser relies on them. | Real time | Per crew member checked | Partner key |
| S3 | Sherehe needs to create a group training booking for an event crew in order to have them trained before the event date. | Immediate | A few per week | Partner key |
| S4 | Sherehe needs to read a booking's status in order to show the organiser whether the training is confirmed. | Within the hour | Per booking viewed | Partner key |
| S5 | Sherehe needs to reschedule or cancel a pending booking in order to follow changes to the event date. | Immediate | Rare | Partner key |

## The Sherehe website's own needs

| # | Statement |
|---|---|
| O1 | The Sherehe website needs organisers to create an account and log in, in order that events and decisions belong to a real organiser. |
| O2 | The Sherehe website needs organisers to create events and their staffing roles, in order that Kazi Connect can see what staff each event needs. |
| O3 | The Sherehe website needs organisers to see the offers on their events and accept or decline each one, in order that Kazi Connect knows which roles to fill. |
| O4 | The Sherehe website needs organisers to browse Ujuzi courses, book crew training and follow the booking, in order to have crews trained before the event (served by S1, S3, S4, S5). |
| O5 | The Sherehe website needs organisers to check a crew member's certificate number, in order to rely only on trained staff (served by S2). |

## Check against the Week 1 audit (Week 2, Part E)

| Need | Maps to audit item |
|---|---|
| K1 | Events: list upcoming events, filter by county; view one event |
| K2 | Staffing roles: list the roles for an event |
| K3, K5 | Staffing offers: receive offers; have a pending offer withdrawn |
| K4 | Staffing offers: accept or decline an offer |
| S1, S3, S4, S5 | Crew trainings |
| S2 | Certificate checks |
| O1 to O5 | Organisers, events, roles, offers, crew trainings, certificate checks |

Gaps flagged: TODO after the interviews (for example, a need a partner raises that the audit does not cover). Audit items with no need: marking an event completed or cancelled is internal to Sherehe and stays out of the partner API.

## Reflection

TODO after the interviews: one honest paragraph on what surprised the team. "Nothing surprised us" does not count, per the handout. Likely material: Kazi expected organisers' phone numbers, which Sherehe will not share, and a pay range where Sherehe stores one pay per shift.
