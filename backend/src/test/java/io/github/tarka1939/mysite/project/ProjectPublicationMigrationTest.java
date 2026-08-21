package io.github.tarka1939.mysite.project;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.Statement;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

/**
 * The one test in this suite that is about a deploy rather than about behaviour.
 *
 * <p>{@code V7__project_publication_and_github_fields.sql} adds {@code project.published}, and
 * it has to answer two questions with two <i>different</i> values: rows that already exist are
 * published (they are the live site), rows inserted from then on are not (they are drafts
 * nobody has approved). A migration that answers both with false takes the portfolio blank on
 * the next deploy, silently, and would be found by a human looking at an empty page.
 *
 * <p>So this deliberately does not use the shared {@code @SpringBootTest} + Flyway-runs-
 * everything setup the other integration tests use. A database built fresh at V7 has no rows to
 * back-fill and therefore cannot fail the way production would: the bug only exists in the
 * transition. Each test here migrates to V6, writes the row an owner would already have, and
 * only then runs V7 -- which is the sequence a real deploy performs.
 *
 * <p>Each test gets its own database inside the shared container, via {@code CREATE DATABASE},
 * so neither can see the other's schema version and the two cannot be made order-dependent by
 * accident.
 */
@Testcontainers
class ProjectPublicationMigrationTest {

    @Container
    static PostgreSQLContainer postgres = new PostgreSQLContainer("postgres:17-alpine");

    /**
     * The dangerous line. A project that existed before V7 is on the live site, and must still
     * be on it afterwards.
     *
     * <p>Flip V7's back-fill to false -- or collapse its four statements into a single
     * {@code ADD COLUMN published boolean NOT NULL DEFAULT false} -- and this is what fails.
     */
    @Test
    void aProjectThatExistedBeforeV7_isStillPublishedAfterIt() throws Exception {
        String url = freshDatabase("v7_backfill");

        migrateTo(url, "6");
        execute(url, """
            INSERT INTO project (title, description)
            VALUES ('Equalizer', 'A hand-written description the owner signed off on')
            """);

        migrateTo(url, "7");

        assertThat(queryBoolean(url, "SELECT published FROM project WHERE title = 'Equalizer'"))
            .as("a project the owner created before Phase 7a must survive the migration published"
                + " -- false here is a blank portfolio on the next deploy")
            .isTrue();
    }

    /**
     * The other half of the same rule, and the reason V7 cannot be written as one statement:
     * once V7 has run, an insert that says nothing about publication produces a draft. This is
     * the column default that stops an auto-created row from reaching the live site.
     */
    @Test
    void aProjectInsertedAfterV7_defaultsToUnpublished() throws Exception {
        String url = freshDatabase("v7_default");

        migrateTo(url, "6");
        migrateTo(url, "7");

        execute(url, """
            INSERT INTO project (title, description)
            VALUES ('Auto-created', 'Placeholder')
            """);

        assertThat(queryBoolean(url, "SELECT published FROM project WHERE title = 'Auto-created'"))
            .as("a row inserted without stating a publication status is a draft")
            .isFalse();
    }

    /**
     * Both values at once, on one database, which is the claim the migration's comment makes and
     * the one a reader is most likely to doubt: the back-fill does not reach forward to new rows
     * and the default does not reach back to old ones.
     */
    @Test
    void theBackfillAndTheColumnDefaultAreDifferentValuesOnTheSameTable() throws Exception {
        String url = freshDatabase("v7_both");

        migrateTo(url, "6");
        execute(url, "INSERT INTO project (title, description) VALUES ('Before', 'Curated')");
        migrateTo(url, "7");
        execute(url, "INSERT INTO project (title, description) VALUES ('After', 'Draft')");

        assertThat(queryBoolean(url, "SELECT published FROM project WHERE title = 'Before'")).isTrue();
        assertThat(queryBoolean(url, "SELECT published FROM project WHERE title = 'After'")).isFalse();
    }

    /**
     * V7's indexes, asserted against {@code pg_indexes} rather than assumed -- the same check
     * {@code GithubWebhookIdempotencyIntegrationTest} makes for V6's. The unique one is not
     * decoration: it is the conflict target the sync upsert infers on, so losing it turns an
     * atomic upsert into a syntax error at runtime.
     */
    @Test
    void v7CreatesTheIndexesTheSyncAndThePublicListingDependOn() throws Exception {
        String url = freshDatabase("v7_indexes");
        migrateTo(url, "7");

        assertThat(queryStrings(url,
            "SELECT indexname FROM pg_indexes WHERE tablename = 'project'"))
            .contains("ux_project_repo_full_name_lower", "ix_project_published_created_at");

        // Case-insensitive, per the index's lower() expression: GitHub hands back whatever case
        // it feels like, and two casings of one repository must not become two projects.
        execute(url, """
            INSERT INTO project (title, description, repo_full_name)
            VALUES ('Equalizer', 'x', 'tarka1939/Equalizer')
            """);
        assertThat(insertFails(url, """
            INSERT INTO project (title, description, repo_full_name)
            VALUES ('Equalizer again', 'x', 'Tarka1939/equalizer')
            """)).isTrue();

        // ...but "no repository" is the common case and is not a value that can collide.
        execute(url, "INSERT INTO project (title, description) VALUES ('No repo A', 'x')");
        execute(url, "INSERT INTO project (title, description) VALUES ('No repo B', 'x')");
    }

    private static String freshDatabase(String name) throws Exception {
        try (Connection connection = DriverManager.getConnection(
                postgres.getJdbcUrl(), postgres.getUsername(), postgres.getPassword());
             Statement statement = connection.createStatement()) {
            statement.execute("CREATE DATABASE " + name);
        }
        return postgres.getJdbcUrl().replaceFirst("/[^/?]+(\\?|$)", "/" + name + "$1");
    }

    private static void migrateTo(String url, String version) {
        Flyway.configure()
            .dataSource(url, postgres.getUsername(), postgres.getPassword())
            .target(version)
            .load()
            .migrate();
    }

    private static void execute(String url, String sql) throws Exception {
        try (Connection connection = connect(url); Statement statement = connection.createStatement()) {
            statement.execute(sql);
        }
    }

    private static boolean insertFails(String url, String sql) {
        try {
            execute(url, sql);
            return false;
        } catch (Exception e) {
            return true;
        }
    }

    private static boolean queryBoolean(String url, String sql) throws Exception {
        try (Connection connection = connect(url);
             Statement statement = connection.createStatement();
             ResultSet rs = statement.executeQuery(sql)) {
            assertThat(rs.next()).as("expected exactly one row from: %s", sql).isTrue();
            return rs.getBoolean(1);
        }
    }

    private static java.util.List<String> queryStrings(String url, String sql) throws Exception {
        try (Connection connection = connect(url);
             Statement statement = connection.createStatement();
             ResultSet rs = statement.executeQuery(sql)) {
            java.util.List<String> values = new java.util.ArrayList<>();
            while (rs.next()) {
                values.add(rs.getString(1));
            }
            return values;
        }
    }

    private static Connection connect(String url) throws Exception {
        return DriverManager.getConnection(url, postgres.getUsername(), postgres.getPassword());
    }
}
