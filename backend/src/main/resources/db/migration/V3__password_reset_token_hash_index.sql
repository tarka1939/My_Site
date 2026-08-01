-- password_reset_token.token_hash was queried (findByTokenHash, hit on every
-- POST /auth/password-reset) with no supporting index since V1 -- a sequential scan that's
-- trivial now but not free forever. Unique, not just indexed: token_hash values are meant to
-- be single-use lookups, so a duplicate (a SHA-256 collision, astronomically unlikely but
-- free to rule out at the DB level) is a real integrity guarantee worth having.
CREATE UNIQUE INDEX ux_password_reset_token_hash ON password_reset_token (token_hash);
