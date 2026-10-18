package io.github.tarka1939.mysite.contact;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import io.github.tarka1939.mysite.TestPostgres;

/**
 * {@code V10__drop_contact_message_requester_ip_hash.sql} (#309), on both databases it will meet:
 * a fresh one, and production's, which already holds messages and their hashes.
 *
 * <p>Not the shared {@code @SpringBootTest} setup, for the reason {@code
 * ProjectPublicationMigrationTest} gives: a database built fresh at V10 has no rows, so it cannot
 * show what the migration does to the rows that exist when it runs. One test here migrates to V9,
 * writes the messages an owner would already have, and only then runs V10, which is the sequence
 * the next deploy performs. Each test gets its own database inside the shared container.
 */
@Testcontainers
class ContactIpHashMigrationTest {

    /** What contact_message holds after V10, in column order. Nothing derived from an address. */
    private static final List<String> COLUMNS_AFTER_V10 = List.of("id", "name", "email", "message", "created_at");

    @Container
    static PostgreSQLContainer postgres = TestPostgres.container();

    @Test
    void fromAnEmptyDatabase_contactMessageHasNoAddressColumnAndNoIndexOnOne() throws Exception {
        String url = freshDatabase("v10_empty");

        migrateTo(url, "10");

        assertThat(columnsOfContactMessage(url)).containsExactlyElementsOf(COLUMNS_AFTER_V10);
        assertThat(indexesOfContactMessage(url))
            .as("the index that served the dropped rate-limit query")
            .doesNotContain("ix_contact_message_ip_hash_created_at");

        // The column was NOT NULL. If it survived, an insert that does not mention it would fail,
        // which is the shape every insert ContactService makes from now on.
        execute(url, "INSERT INTO contact_message (name, email, message) VALUES ('Ada', 'ada@example.invalid', 'Hi')");
        assertThat(queryStrings(url, "SELECT name FROM contact_message")).containsExactly("Ada");
    }

    @Test
    void overExistingMessages_keepsEveryMessageAndDropsEveryHash() throws Exception {
        String url = freshDatabase("v10_rows");

        migrateTo(url, "9");
        // The shape V1 wrote for two senders. Neither hash is a real address's; the test is about
        // the column going, not about what was in it.
        execute(url, """
            INSERT INTO contact_message (name, email, message, created_at, requester_ip_hash) VALUES
              ('Alice', 'alice@example.invalid', 'First',  '2026-10-01T10:00:00Z', repeat('a', 64)),
              ('Bob',   'bob@example.invalid',   'Second', '2026-10-02T11:30:00Z', repeat('b', 64))
            """);
        assertThat(indexesOfContactMessage(url))
            .as("precondition: V1's index exists before V10")
            .contains("ix_contact_message_ip_hash_created_at");

        migrateTo(url, "10");

        assertThat(columnsOfContactMessage(url)).containsExactlyElementsOf(COLUMNS_AFTER_V10);
        assertThat(indexesOfContactMessage(url)).doesNotContain("ix_contact_message_ip_hash_created_at");
        assertThat(queryStrings(url, """
            SELECT name || '|' || email || '|' || message || '|' || to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI')
            FROM contact_message ORDER BY created_at
            """))
            .as("the messages themselves are untouched")
            .containsExactly(
                "Alice|alice@example.invalid|First|2026-10-01 10:00",
                "Bob|bob@example.invalid|Second|2026-10-02 11:30");
    }

    private static List<String> columnsOfContactMessage(String url) throws Exception {
        return queryStrings(url, """
            SELECT column_name FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'contact_message'
            ORDER BY ordinal_position
            """);
    }

    private static List<String> indexesOfContactMessage(String url) throws Exception {
        return queryStrings(url, "SELECT indexname FROM pg_indexes WHERE tablename = 'contact_message'");
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

    private static List<String> queryStrings(String url, String sql) throws Exception {
        try (Connection connection = connect(url);
             Statement statement = connection.createStatement();
             ResultSet rs = statement.executeQuery(sql)) {
            List<String> values = new ArrayList<>();
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
