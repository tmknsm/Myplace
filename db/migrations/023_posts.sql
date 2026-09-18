-- An owner's post on their property page: a few photos and a caption. Posts
-- are public by nature; the page is the audience. Photos attach through
-- documents.post_id the same way improvement and room photos do.
CREATE TABLE IF NOT EXISTS property_posts (
  post_id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(property_id) ON DELETE CASCADE,
  created_by TEXT REFERENCES users(user_id),
  body TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS property_posts_property_idx
  ON property_posts (property_id, created_at DESC);

ALTER TABLE documents ADD COLUMN IF NOT EXISTS post_id TEXT REFERENCES property_posts(post_id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS documents_post_idx ON documents (post_id);
