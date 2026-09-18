-- Person-to-person neighbor requests. Pending until the recipient accepts
-- or declines. An accepted pair is the connection both profiles list.
CREATE TABLE IF NOT EXISTS neighbor_requests (
  request_id TEXT PRIMARY KEY,
  from_user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  to_user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  property_id TEXT REFERENCES properties(property_id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ,
  CHECK (from_user_id <> to_user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS neighbor_requests_open_pair_idx
  ON neighbor_requests (
    LEAST(from_user_id, to_user_id),
    GREATEST(from_user_id, to_user_id)
  )
  WHERE status IN ('pending', 'accepted');

CREATE INDEX IF NOT EXISTS neighbor_requests_to_pending_idx
  ON neighbor_requests (to_user_id)
  WHERE status = 'pending';
