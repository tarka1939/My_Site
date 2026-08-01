-- Phase 2: adds the email column deferred out of V1 (needed for
-- POST /auth/password-reset-request to look up an AdminUser by email -- see
-- docs/DATA_MODEL.md's AdminUser table for why this wasn't in the original draft), and seeds
-- the single admin row deferred from Phase 1 (needed a bcrypt hash, which needed a running
-- app -- see AGENT_LOG.md's Phase 1 entry).

ALTER TABLE admin_user ADD COLUMN email varchar(320) NOT NULL;

CREATE UNIQUE INDEX ux_admin_user_email ON admin_user (email);

-- Seeded credentials: username 'admin', a one-time generated random password (bcrypt-hashed
-- below, plaintext never committed -- shared with the site owner out of band). Log in once
-- and rotate via POST /auth/password-reset-request / POST /auth/password-reset once
-- RESEND_API_KEY is configured.
--
-- Email deliberately uses the RFC 2606 reserved .invalid TLD, not a real address: a real
-- personal email hardcoded into a migration is permanent in git history the moment this
-- merges, and would seed the exact same address into every environment (dev/test/prod) that
-- ever runs this migration, including throwaway Testcontainers databases in CI. Update it to
-- a real address out-of-band (a manual `UPDATE admin_user SET email = ...` against the real
-- deployment DB) before relying on password-reset-request actually reaching an inbox.
INSERT INTO admin_user (id, username, email, password_hash)
VALUES (
    gen_random_uuid(),
    'admin',
    'admin@mysite.invalid',
    '$2a$10$ntRuCNz3AZL5PJDNlWjbUOOQxf9b5ZRy2u6ny26xa/thPND.3Dg7i'
);
