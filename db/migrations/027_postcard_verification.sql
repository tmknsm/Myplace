-- Ownership is verified by a code on a postcard mailed to the property, not
-- by documents and a review desk. The code is generated when the claim is
-- submitted and the card is "sent" at the same moment. The claimant types it
-- in on their account page; a handful of misses closes the attempt.
-- notice_seen_at is when they last looked at the pending house's
-- notifications (the "your code is in the mail" notice).
ALTER TABLE ownership_claims
  ADD COLUMN IF NOT EXISTS postcard_code TEXT,
  ADD COLUMN IF NOT EXISTS postcard_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS code_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS notice_seen_at TIMESTAMPTZ;
