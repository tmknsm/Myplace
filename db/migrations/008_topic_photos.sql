-- Photos attached to a topic card (paint, style, grounds, roof, …).
ALTER TABLE documents ADD COLUMN IF NOT EXISTS topic_id TEXT;
CREATE INDEX IF NOT EXISTS documents_topic_idx ON documents (topic_id);
