-- Phase 7c (issues #58, #59, #61): the site's own analytics, one row per visitor, page, project,
-- link and UTC day.
--
-- The design is docs/DECISIONS.md's 2026-10-18 analytics ADR and the table is docs/DATA_MODEL.md's
-- AnalyticsEvent. What is NOT here matters as much as what is: no IP address, no path or query
-- string, no referrer, no user agent and no time of day. The visitor is visitor_hash, a hex
-- HMAC-SHA256 of the address under a salt made per UTC day and held only in memory
-- (DailyVisitorHasher), so once its day is over a row cannot be tied back to an address.
--
-- Created unconditionally, like github_sync_record: Flyway knows nothing of app.analytics.enabled,
-- and a table that exists while the feature is off costs nothing.

CREATE TABLE analytics_event (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type   varchar(20)  NOT NULL,
    page         varchar(20)  NOT NULL,
    -- No foreign key to project, on purpose (the ADR's last alternative). A project deleted later
    -- keeps its history here, shown on the dashboard with a null title. An FK would have to
    -- cascade that history away, or SET NULL it -- and SET NULL collides with the unique index
    -- below: two deleted projects' rows for one visitor and day become identical, and the second
    -- delete fails on the index. The id is checked against the published projects when the event
    -- arrives instead (AnalyticsService), which is the only point anything is written.
    project_id   uuid,
    link_url     varchar(500),
    visitor_hash char(64)     NOT NULL,
    -- The UTC day, and the only record of when. The same day the visitor_hash's salt belongs to.
    occurred_on  date         NOT NULL,

    -- The two closed lists. The client cannot send free text, and these are what make that true
    -- of the table as well as of the request DTOs.
    CONSTRAINT ck_analytics_event_event_type
        CHECK (event_type IN ('page_view', 'link_click')),
    CONSTRAINT ck_analytics_event_page
        CHECK (page IN ('about', 'projects', 'project', 'contact', 'privacy')),
    -- A project is named exactly when the page is a project's own page. Both sides are NOT NULL
    -- booleans (page is NOT NULL), so this cannot pass by evaluating to null.
    CONSTRAINT ck_analytics_event_project_id
        CHECK ((project_id IS NOT NULL) = (page = 'project')),
    -- A link exactly when the event is a link click.
    CONSTRAINT ck_analytics_event_link_url
        CHECK ((link_url IS NOT NULL) = (event_type = 'link_click')),
    -- A link click happens on a project's page, so its page is always 'project' -- which, with the
    -- check above, also means a link click always names its project.
    CONSTRAINT ck_analytics_event_link_click_page
        CHECK (event_type <> 'link_click' OR page = 'project'),
    -- Not in docs/DATA_MODEL.md's table, and added as defence in depth for "no stored IPs": an
    -- IPv4 or IPv6 literal can never be 64 lowercase hex digits, so a bug that bound the address
    -- where the hash belongs fails here instead of storing it.
    CONSTRAINT ck_analytics_event_visitor_hash
        CHECK (visitor_hash ~ '^[0-9a-f]{64}$')
);

-- THE dedup, and the reason the insert is ON CONFLICT DO NOTHING rather than "has this visitor
-- already been counted today?" followed by an insert. That pre-check is the check-then-act race
-- CLAUDE.md's checklist lists as a standing risk here: a reload and a second tab arrive together,
-- both find nothing, both insert. The index resolves it inside one statement.
--
-- NULLS NOT DISTINCT (Postgres 15+; production and the tests run 16) is what makes it work at
-- all for most rows. A page view has no link_url, and every page but a project's has no
-- project_id, and by default a unique index treats two NULLs as different values -- so two
-- 'about' views by one visitor on one day would never collide, and the dedup would silently do
-- nothing for exactly the commonest event. With NULLS NOT DISTINCT two NULLs are equal here.
--
-- occurred_on leads, so the same index serves the dashboard's date-range filter
-- (AnalyticsEventStore's GROUP BY queries all filter on occurred_on BETWEEN :from AND :to), which
-- is why no second index is created: CLAUDE.md's migration-completeness rule is met by this one.
CREATE UNIQUE INDEX ux_analytics_event_dedup
    ON analytics_event (occurred_on, visitor_hash, event_type, page, project_id, link_url)
    NULLS NOT DISTINCT;
