-- A neighbor request is for one address, not every house that person owns.
-- Unique open row is (from_user, property). Anyone who maintains that
-- property can approve it.
ALTER TABLE neighbor_requests
  ALTER COLUMN property_id SET NOT NULL;

DROP INDEX IF EXISTS neighbor_requests_open_pair_idx;

CREATE UNIQUE INDEX IF NOT EXISTS neighbor_requests_open_property_idx
  ON neighbor_requests (from_user_id, property_id)
  WHERE status IN ('pending', 'accepted');

CREATE INDEX IF NOT EXISTS neighbor_requests_property_pending_idx
  ON neighbor_requests (property_id)
  WHERE status = 'pending';
