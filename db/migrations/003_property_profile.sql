-- Property profile: the owner layer is public by default so a claimed record
-- doubles as the public profile, but each owner contribution can be turned
-- private. One photo can be chosen as the profile cover. Re-runnable.

ALTER TABLE assertions ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'public';

ALTER TABLE documents ADD COLUMN IF NOT EXISTS is_cover BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS documents_cover_idx ON documents (property_id) WHERE is_cover;
