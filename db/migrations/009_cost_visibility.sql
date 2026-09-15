-- Amount paid on an improvement can stay private even when the card is public.
ALTER TABLE property_improvements
  ADD COLUMN IF NOT EXISTS cost_visibility TEXT NOT NULL DEFAULT 'private';
