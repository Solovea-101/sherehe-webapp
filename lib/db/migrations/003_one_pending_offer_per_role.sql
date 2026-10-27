-- At most one pending offer per role. Kazi Connect is the only offering partner, so "a duplicate
-- pending offer" (README, error 409) means a second offer on a role that is still undecided.
-- Once the organiser decides, or the offer is withdrawn, the role can take a new one.
CREATE UNIQUE INDEX offers_one_pending_per_role ON offers (role_id) WHERE status = 'pending';
