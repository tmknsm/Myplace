-- Photo engagement: who liked a photo, what people said under it, and how
-- often it was shared. Likes and comments hang off the photo so they go
-- with it when it is removed; shares are a plain tally on the document.
CREATE TABLE IF NOT EXISTS document_likes (
  document_id TEXT NOT NULL REFERENCES documents(document_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (document_id, user_id)
);

CREATE TABLE IF NOT EXISTS document_comments (
  comment_id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(document_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS document_comments_document_idx
  ON document_comments (document_id, created_at)
  WHERE removed_at IS NULL;

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS share_count INTEGER NOT NULL DEFAULT 0;
