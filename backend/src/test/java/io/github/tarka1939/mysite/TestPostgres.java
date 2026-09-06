package io.github.tarka1939.mysite;

import org.testcontainers.postgresql.PostgreSQLContainer;

/**
 * The one place the test suite names a Postgres image.
 *
 * <h2>Why the version is 16 and not the latest</h2>
 *
 * Production runs <strong>16.15</strong>, the version Ubuntu 24.04 packages. The suite ran
 * {@code postgres:17-alpine} until 2026-09-05, which meant Flyway migrations were validated against
 * one major version and applied to production on another.
 *
 * <p>The direction of that gap was the bad one. Testing on the <em>newer</em> server makes CI more
 * permissive than production: a migration using 17 syntax passes every check and then fails at
 * startup on 16 — after the deploy pipeline (#45) has already swapped the jar in, which is the worst
 * moment available. Had it been reversed, anything that passed would have been safe.
 *
 * <p>So the tests follow production rather than the other way round. When production is upgraded,
 * this constant moves with it, and the tests are what prove the migrations survive the move.
 *
 * <h2>Why a constant rather than thirteen literals</h2>
 *
 * Thirteen test classes each spelled the image out. That is the shape of defect this project has
 * already had twice — a hostname hand-copied across files (#178), a canonical origin across five
 * (#182) — where the copies drift silently because nothing asserts they agree.
 *
 * <p>One place left to change now, and {@code docker-compose.yml} is the only other file in the
 * repository naming a Postgres version. The third copy is the VPS itself, which no constant can
 * reach; {@code psql --version} there is the check.
 */
public final class TestPostgres {

    /** Matches production. See the class javadoc before changing it. */
    public static final String IMAGE = "postgres:16-alpine";

    private TestPostgres() {}

    /**
     * A container on the image production runs.
     *
     * <p>Deliberately returns a new instance rather than sharing one: each test class declares its
     * own {@code static} container so Testcontainers' lifecycle can start and stop it per class,
     * and a shared singleton would change when the database is reset out from under a test.
     */
    public static PostgreSQLContainer container() {
        return new PostgreSQLContainer(IMAGE);
    }
}
