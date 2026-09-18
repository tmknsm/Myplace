-- Owner can take a house off Myplace: no map polygon, no search hit, no
-- public page. Off until they turn it on. The account Manage toggle writes this.
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS removed BOOLEAN NOT NULL DEFAULT FALSE;
