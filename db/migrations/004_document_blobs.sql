-- Temporary BYTEA cache. Superseded by Cloudflare R2; dropped in 005.
CREATE TABLE IF NOT EXISTS document_blobs (
  storage_key TEXT PRIMARY KEY,
  bytes BYTEA NOT NULL,
  byte_size INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
