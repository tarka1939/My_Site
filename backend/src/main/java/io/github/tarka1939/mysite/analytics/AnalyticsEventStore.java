package io.github.tarka1939.mysite.analytics;

import java.sql.Types;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

/**
 * Every statement this module runs against {@code analytics_event}, and nothing else touches the
 * table.
 *
 * <p>Plain SQL through {@link JdbcClient} rather than a JPA entity and repository. Rows are only
 * ever inserted with a native {@code ON CONFLICT} and read back as {@code GROUP BY} aggregates, so
 * an entity would be a mapping nothing loads or saves, and native-query projections would need
 * {@code java.sql.Date}-to-{@code LocalDate} conversions that {@code ResultSet.getObject(..,
 * LocalDate.class)} does directly.
 *
 * <p>All three read queries filter on {@code occurred_on BETWEEN :from AND :to}, which
 * {@code ux_analytics_event_dedup} serves because {@code occurred_on} leads it (V9).
 */
@Component
@ConditionalOnAnalyticsEnabled
class AnalyticsEventStore {

    private final JdbcClient jdbc;

    AnalyticsEventStore(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * Stores one event unless this visitor already has the identical row for that day.
     *
     * <p>No "has this been counted?" read first: that is the check-then-act race CLAUDE.md's
     * checklist names, and the unique index decides it inside this one statement instead. The
     * conflict target names the dedup index's columns, so a violation of any other constraint is
     * not swallowed as a duplicate.
     *
     * @return 1 if a row was inserted, 0 if it was already there
     */
    int insertIfAbsent(AnalyticsEventType type, AnalyticsPage page, UUID projectId, String linkUrl,
                       String visitorHash, LocalDate occurredOn) {
        try {
            return jdbc.sql("""
                    INSERT INTO analytics_event (event_type, page, project_id, link_url, visitor_hash, occurred_on)
                    VALUES (:eventType, :page, :projectId, :linkUrl, :visitorHash, :occurredOn)
                    ON CONFLICT (occurred_on, visitor_hash, event_type, page, project_id, link_url) DO NOTHING
                    """)
                .param("eventType", type.columnValue(), Types.VARCHAR)
                .param("page", page.wireValue(), Types.VARCHAR)
                // Typed explicitly, because these two are often null and an untyped null leaves the
                // driver to guess a uuid column's type.
                .param("projectId", projectId, Types.OTHER)
                .param("linkUrl", linkUrl, Types.VARCHAR)
                .param("visitorHash", visitorHash, Types.VARCHAR)
                .param("occurredOn", occurredOn, Types.DATE)
                .update();
        } catch (DataIntegrityViolationException e) {
            // Postgres words a CHECK or NOT NULL violation with the failing row in full, the
            // visitor hash included, and GlobalExceptionHandler logs an unexpected exception with
            // its causes at ERROR. Rethrown without the cause so that row cannot reach a log; what
            // is kept is enough to find the bug, since the request DTOs already rule each of these
            // combinations out and reaching here means the code, not the client, is wrong.
            throw new IllegalStateException("analytics_event insert violated a constraint: event_type="
                + type.columnValue() + ", page=" + page.wireValue()
                + ", projectId " + (projectId == null ? "absent" : "present")
                + ", linkUrl " + (linkUrl == null ? "absent" : "present"));
        }
    }

    /** Per day with any event: page views, link clicks, and distinct visitors across both. */
    List<DayTotals> totalsByDay(LocalDate from, LocalDate to) {
        return jdbc.sql("""
                SELECT occurred_on,
                       count(*) FILTER (WHERE event_type = 'page_view')  AS views,
                       count(*) FILTER (WHERE event_type = 'link_click') AS link_clicks,
                       count(DISTINCT visitor_hash)                      AS visitors
                  FROM analytics_event
                 WHERE occurred_on BETWEEN :from AND :to
                 GROUP BY occurred_on
                """)
            .param("from", from, Types.DATE)
            .param("to", to, Types.DATE)
            .query((rs, rowNum) -> new DayTotals(
                rs.getObject("occurred_on", LocalDate.class),
                rs.getLong("views"),
                rs.getLong("visitors"),
                rs.getLong("link_clicks")))
            .list();
    }

    /** Page views per page with any; {@code project} counts every project's page together. */
    List<PageViews> viewsByPage(LocalDate from, LocalDate to) {
        return jdbc.sql("""
                SELECT page, count(*) AS views
                  FROM analytics_event
                 WHERE occurred_on BETWEEN :from AND :to
                   AND event_type = 'page_view'
                 GROUP BY page
                """)
            .param("from", from, Types.DATE)
            .param("to", to, Types.DATE)
            .query((rs, rowNum) -> new PageViews(rs.getString("page"), rs.getLong("views")))
            .list();
    }

    /**
     * Everything that happened on a project's page: one row per project for its views (link URL
     * null), and one per project and link URL for clicks.
     */
    List<ProjectEventCount> eventsByProject(LocalDate from, LocalDate to) {
        return jdbc.sql("""
                SELECT project_id, event_type, link_url, count(*) AS events
                  FROM analytics_event
                 WHERE occurred_on BETWEEN :from AND :to
                   AND page = 'project'
                 GROUP BY project_id, event_type, link_url
                """)
            .param("from", from, Types.DATE)
            .param("to", to, Types.DATE)
            .query((rs, rowNum) -> new ProjectEventCount(
                rs.getObject("project_id", UUID.class),
                AnalyticsEventType.fromColumn(rs.getString("event_type")),
                rs.getString("link_url"),
                rs.getLong("events")))
            .list();
    }

    record DayTotals(LocalDate day, long views, long visitors, long linkClicks) {
    }

    record PageViews(String page, long views) {
    }

    record ProjectEventCount(UUID projectId, AnalyticsEventType type, String linkUrl, long events) {
    }
}
