-- Public owner byline: @handle, optional anonymize, and the two avatars
-- (a face for the named state, an abstract mark when they hide).
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS handle TEXT,
  ADD COLUMN IF NOT EXISTS anonymize BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS avatar_url TEXT,
  ADD COLUMN IF NOT EXISTS anonymous_avatar_url TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS users_handle_lower_idx
  ON users (lower(handle))
  WHERE handle IS NOT NULL;
