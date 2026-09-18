-- The per-property columns on property_maintainers (021) are the only source
-- of truth now. Applied after the code that stopped reading these shipped.
ALTER TABLE users
  DROP COLUMN IF EXISTS anonymize,
  DROP COLUMN IF EXISTS hide_street;
