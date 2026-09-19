-- When this person last looked at the notifications for this house. Items
-- newer than that are "unseen" and light the badge on their name and the dot
-- on the house's card. Null means never looked; then anything since they
-- became a maintainer counts.
ALTER TABLE property_maintainers
  ADD COLUMN IF NOT EXISTS inbox_seen_at TIMESTAMPTZ;
