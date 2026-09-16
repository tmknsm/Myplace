-- One profile photo per account. Anonymize only swaps the name for the
-- handle; whoever wants a faceless picture changes their photo instead.
-- avatar_key points at an uploaded file in the document store; avatar_url
-- is what the page loads (an /api/users/:id/avatar path, or a preset).
ALTER TABLE users
  DROP COLUMN IF EXISTS anonymous_avatar_url,
  ADD COLUMN IF NOT EXISTS avatar_key TEXT;
