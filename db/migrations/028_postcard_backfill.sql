-- Claims that were waiting on a document review when the postcard replaced it
-- get a card of their own: a code, sent now, so they show up on the account
-- as pending houses with the "your code is in the mail" notice and the desk
-- can read the code off the claim.
UPDATE ownership_claims
SET method = 'postcard',
    postcard_code = lpad((floor(random() * 1000000))::int::text, 6, '0'),
    postcard_sent_at = now()
WHERE status = 'pending' AND postcard_code IS NULL;
