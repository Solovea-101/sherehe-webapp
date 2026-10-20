-- Crew trainings (bookings made at Ujuzi on an organiser's behalf) and the certificate checks an
-- organiser has run. Ujuzi owns the booking; this table is our record of it and is refreshed from
-- Ujuzi by lib/jobs/bookingPoller.ts.

CREATE SEQUENCE training_id_seq START WITH 5001;
CREATE SEQUENCE check_id_seq    START WITH 7001;

CREATE TABLE crew_trainings (
  id               text PRIMARY KEY DEFAULT 'trn_' || nextval('training_id_seq'),
  organiser_id     text NOT NULL REFERENCES users (id),
  event_id         text NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  course_id        text NOT NULL,                  -- Ujuzi's course id
  ujuzi_booking_id text NOT NULL UNIQUE,           -- Ujuzi's booking id
  crew_size        integer NOT NULL CHECK (crew_size >= 1),
  preferred_start  timestamptz NOT NULL,
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'declined')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX crew_trainings_organiser_idx ON crew_trainings (organiser_id, created_at DESC);
CREATE INDEX crew_trainings_pending_idx   ON crew_trainings (status) WHERE status = 'pending';

CREATE TABLE certificate_checks (
  id             text PRIMARY KEY DEFAULT 'chk_' || nextval('check_id_seq'),
  organiser_id   text NOT NULL REFERENCES users (id),
  certificate_no text NOT NULL,
  valid          boolean NOT NULL,
  course_title   text NOT NULL,
  level          text NOT NULL CHECK (level IN ('short-course', 'grade-III', 'grade-II', 'grade-I')),
  issued_on      date NOT NULL,
  holder         text NOT NULL,
  checked_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX certificate_checks_organiser_idx ON certificate_checks (organiser_id, checked_at DESC);
