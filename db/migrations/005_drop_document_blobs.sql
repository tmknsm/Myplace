-- Photo and document bytes live in Cloudflare R2. Neon keeps the document
-- rows (keys, captions, visibility) and nothing else.
DROP TABLE IF EXISTS document_blobs;
