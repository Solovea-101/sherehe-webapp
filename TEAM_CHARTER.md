# Team Charter: Sherehe

## Team

- Team name: Sherehe
- TODO (name): API Lead
- TODO (name): Backend Dev
- TODO (name): Integration/QA Lead
- TODO (name): Docs/DevOps Lead

Roles rotate every 4 weeks, as the Week 1 handout says.

## App summary

Sherehe is an events app for organisers in Kenya: weddings, conferences, concerts and corporate events. An organiser posts an event with the casual staff roles it needs, such as waiters, ushers, cleaners and security, and the pay per shift for each. Kazi Connect offers student workers for those roles, and the organiser accepts or declines each offer. Organisers can also book group training for their crew at Ujuzi and check a crew member's training certificate before relying on them. It is built with Next.js, TypeScript, PostgreSQL and Tailwind CSS.

## Resource and action audit

Every thing the app stores, and every action a user can take on it (Week 1, Part B).

### Organisers (users)
- Register, log in, log out
- View their own profile

### Events
- Create an event: name, type, county, area, venue, start, end, expected guests
- List upcoming events, filter by county
- View one event
- Mark an event completed or cancelled

### Staffing roles
- Add roles to an event: title, category, headcount, shift start and end, pay per shift
- List the roles for an event
- See how many workers are already confirmed for each role

### Staffing offers
- Receive offers of workers from Kazi Connect
- List the offers on an event
- Accept or decline an offer
- Have a pending offer withdrawn by Kazi Connect

### Crew trainings (bookings made at Ujuzi)
- Browse Ujuzi courses suited to a role
- Book group training for a crew
- See whether a booking is confirmed
- Change the crew size or start date, or cancel, while it is pending

### Certificate checks
- Check a crew member's Ujuzi certificate number

## Ring position

- Upstream provider (we consume their API): Ujuzi
- Downstream consumer (consumes our API): Kazi Connect
- The full ring: Sherehe -> Kazi Connect -> Ujuzi -> Sherehe

## Stack

Next.js (App Router) with TypeScript for the website and the API, PostgreSQL for data, Tailwind CSS v4 for styling, Jest and Supertest for tests, hosted on Render.
