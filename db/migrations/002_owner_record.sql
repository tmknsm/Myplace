-- Owner-maintainer layer: improvements with receipts/photos, co-maintainer
-- invitations, per-property notification preferences, and document links.
-- Written to be re-runnable so it can be applied to a live database.

CREATE TABLE IF NOT EXISTS property_improvements (
  improvement_id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(property_id) ON DELETE CASCADE,
  created_by TEXT REFERENCES users(user_id),
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'other',
  performed_at DATE,
  cost_cents BIGINT,
  contractor TEXT,
  notes TEXT,
  visibility TEXT NOT NULL DEFAULT 'private',
  transferability TEXT NOT NULL DEFAULT 'property_transferable',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS property_improvements_property_idx
  ON property_improvements (property_id, performed_at DESC NULLS LAST, created_at DESC);

ALTER TABLE documents ADD COLUMN IF NOT EXISTS improvement_id TEXT REFERENCES property_improvements(improvement_id) ON DELETE SET NULL;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS caption TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS removed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS documents_improvement_idx ON documents (improvement_id);

-- A handoff invites the buyer to replace the current maintainer; a co-owner
-- invitation adds a maintainer alongside them. Both reuse the same table.
ALTER TABLE handoff_invitations ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'owner';
ALTER TABLE handoff_invitations ADD COLUMN IF NOT EXISTS accepted_by TEXT REFERENCES users(user_id);

CREATE TABLE IF NOT EXISTS notification_preferences (
  preference_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  property_id TEXT NOT NULL REFERENCES properties(property_id) ON DELETE CASCADE,
  pref_key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, property_id, pref_key)
);

ALTER TABLE ownership_claims ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;
