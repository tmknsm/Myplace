-- Account privacy: hide the street on a maintained property page. Independent
-- of anonymize so they can create an alias first and decide about the address
-- after. Off until they turn it on.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS hide_street BOOLEAN NOT NULL DEFAULT FALSE;
