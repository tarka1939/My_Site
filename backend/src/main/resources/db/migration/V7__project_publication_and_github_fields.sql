-- Phase 7a (issue #54): the Project columns a verified GitHub webhook delivery may write, plus
-- the publication flag that keeps an auto-created draft off the live site.
--
-- Decided in docs/DECISIONS.md's 2026-08-18 Phase 7a ADR and tabulated in docs/DATA_MODEL.md's
-- "project additions" section. Sync writes last_pushed_at, default_branch and archived, and
-- nothing else -- title, description, tags, links, images, started_on and completed_on are the
-- owner's, and copying a repository description over hand-written prose would destroy content.
--
--
-- ============================================================================================
-- READ THIS BEFORE CHANGING THE published COLUMN. There are TWO defaults here and they are
-- DIFFERENT VALUES ON PURPOSE. Confusing them is a one-word edit with a public consequence.
--
--   1. The BACKFILL for rows that already exist is TRUE.
--      Every project already in this table was put there deliberately by the owner and is on
--      the live site right now. Migrating them to false would take the portfolio blank on the
--      next deploy, and nothing would report it -- it would be found by a human looking at an
--      empty page. That is the single most dangerous line in this change.
--
--   2. The COLUMN DEFAULT for rows inserted from here on is FALSE.
--      A row created by an inbound webhook delivery is a draft: the owner has not written or
--      approved it, and a curated portfolio that publishes whatever repositories exist has
--      stopped being curated. So an insert that says nothing about publication gets a draft.
--
-- "Existing rows are published, new rows are not" is the whole rule. Neither value is a
-- fallback for the other, and a single ADD COLUMN ... NOT NULL DEFAULT <x> cannot express both
-- -- which is exactly why this is written as four separate statements below rather than one
-- compact one. The compact version is the bug.
--
-- Note that a project created by hand through the CMS (POST /projects) is published unless the
-- request says otherwise. That is ProjectService's doing, not this column's: it sends an
-- explicit value, so the DEFAULT never applies to it. See ProjectWriteRequest.published.
-- ============================================================================================

-- Step 1: add it nullable, with no default at all, so that nothing is silently assigned.
ALTER TABLE project ADD COLUMN published boolean;

-- Step 2: the backfill. TRUE, per (1) above -- these rows are the live site.
UPDATE project SET published = true;

-- Step 3: now that every existing row has a value, forbid absence for good.
ALTER TABLE project ALTER COLUMN published SET NOT NULL;

-- Step 4: and only now the going-forward default, per (2) above. FALSE. This is applied after
-- the backfill precisely so it cannot reach the rows backfilled in step 2.
ALTER TABLE project ALTER COLUMN published SET DEFAULT false;

-- The GitHub-authoritative trio, and the repository link they arrive through. All nullable:
-- projects predating Phase 7a have no repository, and most never will.
ALTER TABLE project ADD COLUMN repo_full_name varchar(255);
ALTER TABLE project ADD COLUMN last_pushed_at timestamptz;
ALTER TABLE project ADD COLUMN default_branch varchar(255);

-- archived is the one of the three that is NOT NULL: "we have not heard" and "not archived"
-- are the same thing for a project with no repository, so there is no null to distinguish, and
-- a NOT NULL boolean saves every reader a three-state check. Existing rows take the default,
-- which here genuinely is the right value for them -- unlike published above.
ALTER TABLE project ADD COLUMN archived boolean NOT NULL DEFAULT false;

-- Matching a delivery to a project is by repo_full_name, so this is the supporting index
-- CLAUDE.md's migration-completeness rule requires for
-- ProjectRepository.findByRepoFullNameIgnoreCase -- and the uniqueness docs/DATA_MODEL.md
-- specifies, and the conflict target the sync upsert infers on. One object, three jobs.
--
-- On lower(), matching ux_tag_name_lower's precedent rather than indexing the raw column.
-- GitHub treats owner and repository names case-insensitively and will happily hand out
-- "Tarka1939/My_Site" where the admin typed "tarka1939/my_site". Case-sensitive matching would
-- read those as two different repositories and create a duplicate draft alongside the curated
-- project -- the exact noise this phase is trying to avoid, arriving because of letter case.
--
-- Unique indexes in Postgres permit many NULLs, which is what is wanted: "no repository" is
-- the common case and is not a value that can collide.
CREATE UNIQUE INDEX ux_project_repo_full_name_lower ON project (lower(repo_full_name));

-- Supports the public listing, which is "published only, newest first" (ProjectRepository's
-- findPublishedIds and findPublishedIdsByTagNamesIgnoreCase, ORDER BY created_at DESC).
--
-- Partial rather than a plain index on published: a two-value column is poor index material on
-- its own, and the query never asks for the false side -- the admin listing that sees drafts is
-- deliberately unfiltered. Indexing only WHERE published keeps the index to the rows the
-- public site actually serves and lets it satisfy the sort at the same time, so the common
-- first-page read is an index scan with no sort step.
CREATE INDEX ix_project_published_created_at ON project (created_at DESC) WHERE published;
