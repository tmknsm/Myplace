-- A house goes to whoever finishes claiming it first. Drafts other people had
-- started on a house that now has a verified owner are closed, along with
-- anything staged against them, so nobody keeps a "finish claiming" button on
-- somebody else's home. Going forward grantOwnership does this at verification.
WITH stale AS (
  SELECT c.claim_id
  FROM ownership_claims c
  WHERE c.status = 'draft'
    AND EXISTS (
      SELECT 1 FROM property_maintainers m
      WHERE m.property_id = c.property_id AND m.revoked_at IS NULL AND m.user_id <> c.user_id
    )
),
closed AS (
  UPDATE ownership_claims SET status = 'superseded'
  WHERE claim_id IN (SELECT claim_id FROM stale)
  RETURNING claim_id
)
UPDATE documents SET removed_at = now()
WHERE claim_id IN (SELECT claim_id FROM closed) AND removed_at IS NULL;
