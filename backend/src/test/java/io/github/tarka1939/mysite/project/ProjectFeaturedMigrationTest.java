package io.github.tarka1939.mysite.project;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import io.github.tarka1939.mysite.TestPostgres;

/**
 * {@code V11__project_featured.sql} as a deploy rather than as a schema, in the shape of
 * {@link ProjectPublicationMigrationTest}: migrate to the version before, write the rows a live
 * database already has, then run V11, which is the sequence a real deploy performs.
 *
 * <p>Two claims in the migration's header are about the transition, and a database built fresh at
 * V11 cannot test either. Existing projects must come out not featured, or the first deploy
 * reorders the live site without the owner having featured anything. And an insert that does not
 * name the column must still succeed, because that is every insert the previous jar makes: it is
 * the {@code DEFAULT} that makes rolling back to that jar safe, and the column's {@code NOT NULL}
 * that would make it fail without one.
 */
@Testcontainers
class ProjectFeaturedMigrationTest {

    @Container
    static PostgreSQLContainer postgres = TestPostgres.container();

    @Test
    void aProjectThatExistedBeforeV11_isNotFeaturedAfterIt() throws Exception {
        String url = freshDatabase("v11_existing");

        migrateTo(url, "10");
        execute(url, """
            INSERT INTO project (title, description, published)
            VALUES ('Equalizer', 'A hand-written description', true)
            """);

        migrateTo(url, "11");

        assertThat(queryBoolean(url, "SELECT featured FROM project WHERE title = 'Equalizer'"))
            .as("nothing is featured until the owner features it")
            .isFalse();
    }

    /**
     * The previous jar's insert, which knows nothing of the column. Drop V11's {@code DEFAULT}
     * and this fails with a not-null violation, which on a rolled-back production is every
     * project the admin creates and every draft GitHub sync tries to insert.
     */
    @Test
    void anInsertThatDoesNotNameTheColumn_succeedsAndIsNotFeatured() throws Exception {
        String url = freshDatabase("v11_default");
        migrateTo(url, "11");

        execute(url, "INSERT INTO project (title, description) VALUES ('Old jar', 'x')");

        assertThat(queryBoolean(url, "SELECT featured FROM project WHERE title = 'Old jar'"))
            .isFalse();
    }

    /** Two states, not three: null is not a value a reader of this column has to handle. */
    @Test
    void featuredIsNotNullable() throws Exception {
        String url = freshDatabase("v11_not_null");
        migrateTo(url, "11");

        assertThatThrownBy(() -> execute(url,
            "INSERT INTO project (title, description, featured) VALUES ('Null', 'x', NULL)"))
            .isInstanceOf(SQLException.class)
            .hasMessageContaining("featured");
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
        try (Connection connection = connect(url);
             Statement statement = connection.createStatement()) {
            statement.execute(sql);
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

    private static Connection connect(String url) throws Exception {
        return DriverManager.getConnection(url, postgres.getUsername(), postgres.getPassword());
    }
}
