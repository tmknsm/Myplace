-- The other half of a neighbor pair: which of the requester's houses
-- this connection is from, so the owner isn't tied to every address they have.
ALTER TABLE neighbor_requests
  ADD COLUMN IF NOT EXISTS from_property_id TEXT REFERENCES properties(property_id) ON DELETE SET NULL;

UPDATE neighbor_requests r
SET from_property_id = (
  SELECT m.property_id
  FROM property_maintainers m
  WHERE m.user_id = r.from_user_id AND m.revoked_at IS NULL
  ORDER BY m.verified_at ASC
  LIMIT 1
)
WHERE from_property_id IS NULL;

CREATE INDEX IF NOT EXISTS neighbor_requests_from_property_idx
  ON neighbor_requests (from_property_id)
  WHERE from_property_id IS NOT NULL AND status IN ('pending', 'accepted');
