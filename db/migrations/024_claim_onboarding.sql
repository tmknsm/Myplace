-- Choices made while claiming, before anyone has reviewed the claim. They sit
-- on the claim until it is verified, then land where they belong: name and
-- street on the maintainer row, the listing flag on the property, the hero
-- photo as the public cover and (by default) the owner's first post.
ALTER TABLE ownership_claims
  ADD COLUMN IF NOT EXISTS anonymize BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS hide_street BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS hide_listing BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS hero_document_id TEXT REFERENCES documents(document_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS hero_caption TEXT,
  ADD COLUMN IF NOT EXISTS hero_as_post BOOLEAN NOT NULL DEFAULT TRUE;
