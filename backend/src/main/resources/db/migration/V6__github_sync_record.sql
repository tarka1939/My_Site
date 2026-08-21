-- Phase 7a (issues #53, #55): the GitHub webhook receiver's delivery ledger.
--
-- Scope is deliberately the *receiver* only. This table answers one question -- "have I
-- already accepted this delivery?" -- and nothing about what a delivery should change on a
-- Project, which is issue #54 and an open decision (the portfolio's prose is hand-curated,
-- so a handler that copied a repo description over Project.description would destroy it).
--
-- Divergences from the draft table in docs/DATA_MODEL.md, which that file itself flags as "a
-- draft to confirm or rewrite before implementing" (docs/DATA_MODEL.md is rewritten to match
-- in this same commit):
--
--   * project_id and last_synced_at are NOT created here. Both describe a sync that this phase
--     does not perform; last_synced_at in particular would be a column whose every value is a
--     lie. #54 adds them when it knows what it wants to link, and when.
--   * event_type is added. The draft has no room for X-GitHub-Event, and a recorded delivery
--     that does not say whether it was a push, a release or a ping is close to useless for the
--     "on push/release events" work the TODO describes next.
--   * repo_full_name is nullable, where the draft has it NOT NULL. Not every delivery names a
--     repository -- an organization-level `ping` has no `repository` object at all -- and a
--     verified delivery must still be recorded, or idempotency has a hole exactly where the
--     payload is unusual. NULL here means "this delivery did not name a repo", not "unknown".
--   * received_at replaces the draft's last_synced_at as the mandatory timestamp: when the
--     delivery was accepted, which is a fact this phase actually knows.

CREATE TABLE github_sync_record (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    github_delivery_id varchar(255) NOT NULL,
    event_type         varchar(100) NOT NULL,
    repo_full_name     varchar(255),
    received_at        timestamptz  NOT NULL DEFAULT now(),
    -- Verbatim payload, for debugging a delivery that cannot easily be replayed. jsonb rather
    -- than text so it stays queryable (->, @>, jsonb_path_query) when diagnosing a sync.
    --
    -- Known, accepted limitation: jsonb cannot store an escaped NUL (backslash-u-0000) inside a
    -- JSON string, so a payload containing one would fail this INSERT and surface as a 500,
    -- after which GitHub marks the delivery failed and retries. Judged acceptable -- GitHub's
    -- payloads are repo metadata and user-authored text, neither of which normally carries an
    -- escaped NUL, and the failure is loud and attributable rather than silent. Switching the
    -- column to text would trade that away for losing the queryability the column exists for.
    raw_payload        jsonb
);

-- THE idempotency guard, and the reason the receiver inserts with ON CONFLICT DO NOTHING
-- instead of asking "have I seen this delivery?" and then inserting. GitHub redelivers --
-- manually from the repository's webhook settings, automatically after some failures -- and
-- two redeliveries can be in flight at once, so a read-then-write pre-check is exactly the
-- check-then-act shape CLAUDE.md's correctness checklist lists as a standing risk in this
-- codebase. A pre-check would let both racers through; a unique index cannot.
--
-- This is also the supporting index CLAUDE.md's migration-completeness rule requires for
-- GithubSyncRecordRepository.findByGithubDeliveryId, which queries by a non-primary-key
-- column. One object serves both purposes -- stated rather than assumed, and asserted against
-- pg_indexes in GithubWebhookIdempotencyIntegrationTest rather than taken on trust.
CREATE UNIQUE INDEX ux_github_sync_record_delivery_id ON github_sync_record (github_delivery_id);
