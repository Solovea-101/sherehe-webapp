-- Sherehe schema, version 1. Applied once by lib/db/migrate.ts, inside a transaction.
-- Not here yet: crew_trainings and certificate_checks. Their shape depends on Ujuzi's contract and
-- the humans' design of endpoints 16-21, so they arrive in a later migration.

-- Ids are a prefix plus a counter, matching the other two systems (usr_1001, evt_2001, ...).
-- Seed rows carry explicit ids; whatever loads them must then setval() each sequence past the
-- highest id so new rows do not collide.
CREATE SEQUENCE user_id_seq  START WITH 1001;
CREATE SEQUENCE event_id_seq START WITH 2001;
CREATE SEQUENCE role_id_seq  START WITH 3001;
CREATE SEQUENCE offer_id_seq START WITH 4001;

CREATE TABLE users (
  id            text PRIMARY KEY DEFAULT 'usr_' || nextval('user_id_seq'),
  email         text NOT NULL,
  name          text NOT NULL,
  password_hash text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));

CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  user_id    text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_user_id_idx ON sessions (user_id);

CREATE TABLE events (
  id              text PRIMARY KEY DEFAULT 'evt_' || nextval('event_id_seq'),
  organiser_id    text NOT NULL REFERENCES users (id),
  name            text NOT NULL,
  type            text NOT NULL CHECK (type IN ('wedding', 'conference', 'concert', 'corporate', 'other')),
  county          text NOT NULL,
  area            text NOT NULL,
  venue           text NOT NULL,
  starts_at       timestamptz NOT NULL,
  ends_at         timestamptz NOT NULL,
  expected_guests integer NOT NULL CHECK (expected_guests >= 1),
  status          text NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'completed', 'cancelled')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX events_status_starts_at_idx ON events (status, starts_at);
CREATE INDEX events_county_idx ON events (lower(county));

CREATE TABLE roles (
  id            text PRIMARY KEY DEFAULT 'rol_' || nextval('role_id_seq'),
  event_id      text NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  title         text NOT NULL,
  category      text NOT NULL CHECK (category IN (
                  'accommodation', 'campus', 'catering', 'cleaning', 'electrical',
                  'events', 'plumbing', 'security', 'tutoring')),
  headcount     integer NOT NULL CHECK (headcount >= 1),
  filled        integer NOT NULL DEFAULT 0 CHECK (filled >= 0),
  shift_start   timestamptz NOT NULL,
  shift_end     timestamptz NOT NULL,
  pay_per_shift integer NOT NULL CHECK (pay_per_shift >= 0), -- KES
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (filled <= headcount),
  CHECK (shift_end > shift_start)
);
CREATE INDEX roles_event_id_idx ON roles (event_id);

CREATE TABLE offers (
  id              text PRIMARY KEY DEFAULT 'ofr_' || nextval('offer_id_seq'),
  role_id         text NOT NULL REFERENCES roles (id) ON DELETE CASCADE,
  event_id        text NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  workers_offered integer NOT NULL CHECK (workers_offered >= 1),
  note            text NOT NULL DEFAULT '',
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX offers_role_id_idx ON offers (role_id);
CREATE INDEX offers_event_id_idx ON offers (event_id);
