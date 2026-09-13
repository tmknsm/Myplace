-- Keep uploaded files next to their document rows so a tunnel, Worker, or
-- fresh VM can serve photos that were uploaded against the same database.
CREATE TABLE IF NOT EXISTS document_blobs (
  storage_key TEXT PRIMARY KEY,
  bytes BYTEA NOT NULL,
  byte_size INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
