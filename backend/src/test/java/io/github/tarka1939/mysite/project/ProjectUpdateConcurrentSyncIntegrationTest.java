package io.github.tarka1939.mysite.project;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.SoftAssertions.assertSoftly;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

import io.github.tarka1939.mysite.TestPostgres;

/**
 * An admin save must not write back the three columns GitHub sync owns (#304).
 *
 * <p>{@link ProjectService#updateProject} loads the {@link Project}, changes the owner's fields and
 * lets Hibernate flush it. With no {@code @DynamicUpdate} that flush is an UPDATE of every
 * updatable column, so if {@code last_pushed_at}, {@code default_branch} and {@code archived} were
 * among them, the save would write whatever it read at load time over anything
 * {@link ProjectRepository#upsertFromGithub} committed in between. The next delivery for the
 * repository would correct whichever of them its payload carries; until then the project would
 * show the old push, branch and archived flag.
 *
 * <p>All three are asserted, softly, so a regression on any one of them is named in the failure
 * rather than hidden behind the first.
 *
 * <p>The interleaving is made deterministic the way {@code ProjectUpdateStaleReadIntegrationTest}
 * makes it: the save's read happens in an outer transaction, the sync runs to commit on another
 * thread, and then the save runs through the real {@link ProjectService#updateProject}, which
 * joins the outer transaction and so finds the entity it read before the sync.
 *
 * <p>Not {@code @Transactional}: the sync has to commit for real, on its own connection.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.NONE)
@Testcontainers
@ActiveProfiles("test")
class ProjectUpdateConcurrentSyncIntegrationTest {

    @Container
    @ServiceConnection
    static PostgreSQLContainer postgres = TestPostgres.container();

    private static final String REPO = "tarka1939/Raced";

    private static final Instant FIRST_PUSH = Instant.parse("2026-10-01T09:00:00Z");
    private static final Instant SECOND_PUSH = Instant.parse("2026-10-18T12:00:00Z");

    @Autowired
    private ProjectService projectService;

    @Autowired
    private ProjectRepository projectRepository;

    @Autowired
    private TransactionTemplate transactionTemplate;

    @Test
    void anAdminSaveThatReadTheProjectBeforeAConcurrentSync_leavesTheSyncedColumnsAsSyncWroteThem() {
        // A draft sync created from a first delivery.
        UUID id = projectService.syncFromGithub(
            new GithubRepositoryMetadata(REPO, FIRST_PUSH, "main", false)).projectId();

        transactionTemplate.executeWithoutResult(status -> {
            // The save's read: the project enters this persistence context with the first
            // delivery's values.
            projectRepository.findById(id).orElseThrow();

            // Between that read and the save's flush, a second delivery commits a new value for
            // each of the three columns.
            CompletableFuture.runAsync(() -> projectService.syncFromGithub(
                new GithubRepositoryMetadata(REPO, SECOND_PUSH, "trunk", true))).join();

            // The save: the owner's prose replacing the placeholder, repoFullName omitted.
            projectService.updateProject(id, ownerEdit());
        });

        ProjectResponse after = projectService.getProject(id);

        // The save did flush, so the assertions below are about a real UPDATE of the row: the
        // title was the placeholder sync gave the draft ("Raced") until the save replaced it.
        assertThat(after.title()).isEqualTo("The raced project");
        assertThat(after.description()).isEqualTo("The owner's description, written during a push.");

        assertSoftly(softly -> {
            softly.assertThat(after.lastPushedAt())
                .as("last_pushed_at: the save wrote back the value it read")
                .isEqualTo(SECOND_PUSH);
            softly.assertThat(after.defaultBranch())
                .as("default_branch: the save wrote back the value it read")
                .isEqualTo("trunk");
            softly.assertThat(after.archived())
                .as("archived: the save wrote back the value it read")
                .isTrue();
        });
    }

    private static ProjectWriteRequest ownerEdit() {
        return new ProjectWriteRequest(
            "The raced project", "The owner's description, written during a push.", List.of(),
            List.of(),
            List.of(), null, null, null, null);
    }
}
