-- The About page (#213): one row, created here, never deleted.
--
-- A singleton by construction rather than by convention. `CHECK (id = 1)` on the primary key makes
-- a second row impossible at the database level, so the application can `findById(1)` and treat
-- absence as a broken deployment rather than as a state to handle. That is what lets the public
-- GET always answer 200 and the SPA have no "not created yet" branch: an unwritten page is a row
-- with an empty body, not a missing one.
--
-- A slug-keyed `page` table was considered and deliberately not built -- see docs/DECISIONS.md,
-- 2026-09-20. Going from this to that later is a rename plus one column.
CREATE TABLE about_page (
    id         SMALLINT PRIMARY KEY CHECK (id = 1),
    body       TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Inserted by the migration, not lazily by the application, so `updated_at` is never null and
-- there is no first-request race between two instances both deciding to create it.
INSERT INTO about_page (id, body) VALUES (1, '');
