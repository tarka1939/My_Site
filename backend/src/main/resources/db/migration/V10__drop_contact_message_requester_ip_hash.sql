-- Issue #309: the contact form stops storing anything about the sender's address.
--
-- requester_ip_hash was a plain SHA-256 of the sender's IP (ClientIpHasher), kept for as long as
-- the message was. Unsalted, so it was reversible: there are only about 4.3 billion IPv4 addresses,
-- and hashing them all recovers the address behind every row. It existed only so ContactService
-- could count a sender's messages in the trailing hour, and that limit now lives in
-- InMemoryRateLimiter under its own "contact:" key, the way login and password reset already did.
--
-- Dropping the column takes the existing rows' hashes with it, on purpose (the owner's decision on
-- #309): keeping them would keep exactly the data this exists to remove. The messages themselves
-- are untouched. Not reversible - there is nothing to restore the hashes from, and an old jar
-- rolled back over this schema fails Hibernate's validate on the missing column.
--
-- The index goes first and by name, although DROP COLUMN would take it anyway: the rate-limit query
-- it served is gone, and saying so here is clearer than leaving it to a side effect.

DROP INDEX ix_contact_message_ip_hash_created_at;

ALTER TABLE contact_message DROP COLUMN requester_ip_hash;
