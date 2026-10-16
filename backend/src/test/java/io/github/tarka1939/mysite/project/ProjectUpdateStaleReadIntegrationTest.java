package io.github.tarka1939.mysite.project;

import static org.assertj.core.api.Assertions.assertThat;

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
 * Pins the step {@code ProjectService.requireTagsToPublish}'s concurrency argument rests on: a
 * PUT whose read of {@code published} has gone stale still writes that stale value back together
 * with its tags, so it cannot leave a published project with no tags (#148).
 *
 * <p>That holds only because replacing the tags set makes Hibernate update the project row, which
 * is Hibernate's behaviour and not this code's. Without it, the save below changes no column, so
 * it would rewrite {@code project_tags} and nothing else -- deleting the tag the concurrent publish
 * added while the row stayed published. This test fails if that ever becomes true.
 *
 * <p>The interleaving is made deterministic rather than raced: the save's read happens in an outer
 * transaction, the publish runs to commit on another thread, and then the save itself runs through
 * the real {@link ProjectService#updateProject}, which joins the outer transaction and so finds the
 * stale draft it read. A real race over HTTP would mostly measure scheduling jitter -- see
 * {@code GithubProjectSyncIntegrationTest}'s note on #53.
 *
 * <p>Not {@code @Transactional}: the publish has to commit for real, on its own connection.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.NONE)
@Testcontainers
@ActiveProfiles("test")
class ProjectUpdateStaleReadIntegrationTest {

    @Container
    @ServiceConnection
    static PostgreSQLContainer postgres = TestPostgres.container();

    @Autowired
    private ProjectService projectService;

    @Autowired
    private ProjectRepository projectRepository;

    @Autowired
    private TransactionTemplate transactionTemplate;

    @Test
    void aTaglessSaveThatReadADraftBeforeAConcurrentPublish_cannotLeaveItPublishedWithNoTags() {
        UUID id = projectService.createProject(request(List.of(), false)).id();

        transactionTemplate.executeWithoutResult(status -> {
            // The save's read: the project enters this persistence context as a draft.
            projectRepository.findById(id).orElseThrow();

            // Between that read and the save's flush, another PUT publishes it with a tag.
            CompletableFuture.runAsync(() ->
                projectService.updateProject(id, request(List.of("raced"), true))).join();

            // The save: same title and description, no tags, published omitted. Judged against
            // the stale draft it passes, and it changes no column -- the shape with nothing but
            // the replaced tags set to make the row dirty.
            projectService.updateProject(id, request(List.of(), null));
        });

        ProjectResponse after = projectService.getProject(id);
        assertThat(after.published() && after.tags().isEmpty())
            .as("published with no tags: the save rewrote project_tags without the project row")
            .isFalse();
        // What does happen: the save landed whole, stale published and all, and the publish was
        // lost. Last-write-wins, the standing behaviour for two concurrent edits.
        assertThat(after.published()).isFalse();
        assertThat(after.tags()).isEmpty();
    }

    private static ProjectWriteRequest request(List<String> tags, Boolean published) {
        return new ProjectWriteRequest(
            "Raced draft", "Unchanged by the save", List.of(), List.of(), tags,
            null, null, published, null);
    }
}
