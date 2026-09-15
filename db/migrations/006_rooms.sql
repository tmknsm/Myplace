-- Rooms the owner fills in: type-specific finishes plus photos.
-- Re-runnable so it can land on a live database.

CREATE TABLE IF NOT EXISTS property_rooms (
  room_id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(property_id) ON DELETE CASCADE,
  created_by TEXT REFERENCES users(user_id),
  kind TEXT NOT NULL,
  title TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  visibility TEXT NOT NULL DEFAULT 'public',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS property_rooms_property_idx
  ON property_rooms (property_id, created_at);

ALTER TABLE documents ADD COLUMN IF NOT EXISTS room_id TEXT REFERENCES property_rooms(room_id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS documents_room_idx ON documents (room_id);
