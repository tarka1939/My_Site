-- Phase 6: a project date period (issue #85, see the 2026-08-08 project-dates ADR in
-- docs/DECISIONS.md). started_on/completed_on describe *the work*; created_at/updated_at
-- describe *the row* -- the two routinely differ by years for migrated content.
--
-- Additive and non-destructive: both columns are nullable, so existing rows are untouched
-- and no backfill is required. NULL completed_on is a meaningful value (the project is
-- ongoing), not missing data; NULL started_on means unspecified.

ALTER TABLE project
    ADD COLUMN started_on   date,
    ADD COLUMN completed_on date;

-- Defence in depth: the same invariant is enforced at the DTO layer (see
-- ValidProjectDatePeriod) so the API answers 400 rather than letting this constraint surface
-- as a 500. This one holds regardless of how a row is written -- psql, a future migration,
-- a bulk import.
--
-- Written so it can never evaluate to NULL, because a CHECK is *satisfied* by NULL (SQL
-- three-valued logic) -- a naive `completed_on >= started_on` would silently permit every
-- row where either column is null, including "completed but never started", which is
-- precisely one of the two cases this is meant to reject. Case by case:
--   both NULL              -> first disjunct TRUE                       -> permitted
--   started_on only        -> first disjunct TRUE                       -> permitted
--   both set, end >= start -> FALSE OR (TRUE AND TRUE)                  -> permitted
--   both set, end <  start -> FALSE OR (TRUE AND FALSE)                 -> rejected
--   completed_on only      -> FALSE OR (FALSE AND NULL) = FALSE OR FALSE -> rejected
-- `>=` not `>`: a project started and finished on the same day is legitimate, and the
-- contract only forbids completed_on *preceding* started_on.
ALTER TABLE project
    ADD CONSTRAINT ck_project_date_period CHECK (
        completed_on IS NULL
        OR (started_on IS NOT NULL AND completed_on >= started_on)
    );
