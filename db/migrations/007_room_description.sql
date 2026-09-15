-- Optional blurb under the room type on the card. Re-runnable.
ALTER TABLE property_rooms ADD COLUMN IF NOT EXISTS description TEXT;
