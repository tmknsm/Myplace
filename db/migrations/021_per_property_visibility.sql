-- Visibility belongs to the pairing of a person and a house, not the account.
-- Someone with two addresses can hide the street on one and show it on the
-- other, or use their alias on one page and their real name on the other.
-- The account-level flags seed each maintainer row so nothing changes on day one.
ALTER TABLE property_maintainers
  ADD COLUMN IF NOT EXISTS anonymize BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS hide_street BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE property_maintainers m
SET anonymize = u.anonymize,
    hide_street = u.hide_street
FROM users u
WHERE u.user_id = m.user_id;
