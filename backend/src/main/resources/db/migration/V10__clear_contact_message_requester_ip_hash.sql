-- Issue #309: the contact form stops storing anything about the sender's address.
--
-- requester_ip_hash was a plain SHA-256 of the sender's IP (ClientIpHasher), kept for as long as
-- the message was. Unsalted, so it was reversible: there are only about 4.3 billion IPv4 addresses,
-- and hashing them all recovers the address behind every row. It existed only so ContactService
-- could count a sender's messages in the trailing hour, and that limit now lives in
-- InMemoryRateLimiter under its own "contact:" key, the way login and password reset already did.
--
-- Step one of two (the owner's decision on #309, 2026-10-19): every stored hash is blanked here,
-- so no row holds one once this has run, but the emptied column stays. That is for the
-- release's automatic rollback. deploy/deploy.sh restarts the previous jar when the new one never
-- turns healthy, and by then Flyway has already run this. The previous jar maps the column and
-- validates the schema at startup, so a dropped column would stop it booting and leave the site
-- down. Over this schema it boots, and for as long as it runs it stores hashes again, which this
-- file will not blank a second time: Flyway runs it once. After a rollback, re-run the UPDATE
-- below by hand, or leave them for #318, which drops the column in a release after this one.
--
-- Not reversible, on purpose: there is nothing to restore the hashes from, and keeping them would
-- keep exactly the data this exists to remove. The messages themselves are untouched.
--
-- The index goes now. The query it served is gone from the new jar, and a rolled-back jar's count
-- still works without it, over a table this small.

DROP INDEX ix_contact_message_ip_hash_created_at;

ALTER TABLE contact_message ALTER COLUMN requester_ip_hash DROP NOT NULL;

UPDATE contact_message SET requester_ip_hash = NULL;
