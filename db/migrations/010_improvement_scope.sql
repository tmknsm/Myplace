-- What the job covered, separate from who did it and the materials used.
ALTER TABLE property_improvements
  ADD COLUMN IF NOT EXISTS scope TEXT;
