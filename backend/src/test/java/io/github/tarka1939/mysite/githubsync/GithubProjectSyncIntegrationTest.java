package io.github.tarka1939.mysite.githubsync;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.test.context.ActiveProfiles;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

import io.github.tarka1939.mysite.PageResponse;
import io.github.tarka1939.mysite.ResourceNotFoundException;
import io.github.tarka1939.mysite.project.LinkDto;
import io.github.tarka1939.mysite.project.ProjectResponse;
import io.github.tarka1939.mysite.project.ProjectService;
import io.github.tarka1939.mysite.project.ProjectWriteRequest;

/**
 * The sync handler end to end, driven at {@link GithubSyncService#accept} rather than over HTTP.
 *
 * <p><b>Below the HTTP layer on purpose.</b> #53's twelve-way concurrent HTTP test passed against
 * a check-then-act pre-check it was meant to catch, because dispatch jitter across a servlet
 * container is wider than the race window -- it measured the harness. The claims here are about
 * what a delivery writes, and every layer between the signature check and the write only adds
 * noise to that. Signature verification and status codes have their own tests
 * ({@code GithubWebhookIntegrationTest}); this one starts where those stop.
 *
 * <p>Not {@code @Transactional}: {@code accept} commits the ledger row before publishing, and the
 * listener then opens its own transaction. Wrapping the test in one would merge boundaries the
 * production code deliberately keeps apart, so each test uses its own repository name instead.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.NONE, properties = {
    "app.github-sync.enabled=true",
    "app.github-sync.webhook-secret=integration-test-github-webhook-secret",
    // The allowlist under test. Deliberately does NOT include tarka1939/private-experiment.
    "app.github-sync.synced-repositories=tarka1939/Equalizer,tarka1939/My_Site"
})
@Testcontainers
@ActiveProfiles("test")
class GithubProjectSyncIntegrationTest {

    @Container
    @ServiceConnection
    static PostgreSQLContainer postgres = new PostgreSQLContainer("postgres:17-alpine");

    @Autowired
    private GithubSyncService githubSyncService;

    @Autowired
    private ProjectService projectService;

    private static final Pageable FIRST_PAGE =
        PageRequest.of(0, 50, Sort.by(Sort.Direction.DESC, "createdAt"));

    private String repo;

    /**
     * Not @Transactional, so nothing rolls back -- and the unique index on repo_full_name means
     * two tests reusing one repository name would collide rather than be independent. Clearing
     * the table between tests is the cheaper of the two available honesties; the alternative,
     * a different repository name per test, would also have to keep the allowlist in step.
     */
    @BeforeEach
    void startFromAnEmptyProjectTable() {
        projectService.listAllProjects(FIRST_PAGE, List.of())
            .content()
            .forEach(project -> projectService.deleteProject(project.id()));
        repo = "tarka1939/Equalizer";
    }

    // -------------------------------------------------------------------------------------
    // Rule 1: sync never writes a curated field.
    // -------------------------------------------------------------------------------------

    /**
     * The claim the whole phase exists to protect, asserted field by field rather than by
     * "the update succeeded". Every curated value is compared to the exact value it had before
     * the delivery -- a handler that copied {@code repository.description} across would still
     * return a 2xx and still update the three GitHub fields correctly, and only this comparison
     * would notice.
     */
    @Test
    void aPushForAMatchedProject_leavesEveryCuratedFieldExactlyAsItWas() {
        ProjectResponse before = createCuratedProject(repo);

        githubSyncService.accept(UUID.randomUUID().toString(), "push", pushPayload(
            repo, 1755777600L, "main", false,
            "GitHub's own blurb, which must never reach Project.description"));

        ProjectResponse after = projectService.getProject(before.id());

        assertThat(after.title()).isEqualTo(before.title());
        assertThat(after.description()).isEqualTo(before.description());
        assertThat(after.description()).doesNotContain("GitHub's own blurb");
        assertThat(after.links()).isEqualTo(before.links());
        assertThat(after.images()).isEqualTo(before.images());
        assertThat(after.tags()).isEqualTo(before.tags());
        assertThat(after.startedOn()).isEqualTo(before.startedOn());
        assertThat(after.completedOn()).isEqualTo(before.completedOn());
        assertThat(after.createdAt()).isEqualTo(before.createdAt());

        // ...and the project stays where the owner put it: on the site.
        assertThat(after.published()).isTrue();
    }

    /** Rule 2: the three fields GitHub is authoritative for, and those are written. */
    @Test
    void aPushForAMatchedProject_writesTheThreeGithubFields() {
        ProjectResponse before = createCuratedProject(repo);
        assertThat(before.lastPushedAt()).isNull();

        githubSyncService.accept(UUID.randomUUID().toString(), "push",
            pushPayload(repo, 1755777600L, "trunk", true, "ignored"));

        ProjectResponse after = projectService.getProject(before.id());

        assertThat(after.lastPushedAt()).isEqualTo(Instant.ofEpochSecond(1755777600L));
        assertThat(after.defaultBranch()).isEqualTo("trunk");
        assertThat(after.archived()).isTrue();
    }

    /**
     * The repository is matched case-insensitively, so a delivery reporting a different
     * capitalisation updates the existing project rather than creating a second one beside it.
     */
    @Test
    void aPushWithDifferentCasing_matchesTheSameProject() {
        ProjectResponse before = createCuratedProject(repo);

        githubSyncService.accept(UUID.randomUUID().toString(), "push",
            pushPayload("TARKA1939/equalizer", 1755777600L, "main", false, "x"));

        assertThat(allProjects()).hasSize(1);
        assertThat(projectService.getProject(before.id()).lastPushedAt()).isNotNull();
    }

    // -------------------------------------------------------------------------------------
    // Rule 3: an unmatched repository creates an unpublished draft, never a live entry.
    // -------------------------------------------------------------------------------------

    @Test
    void aPushForAnUnknownRepository_createsAnUnpublishedDraftThatIsNotOnThePublicSite() {
        githubSyncService.accept(UUID.randomUUID().toString(), "push",
            pushPayload(repo, 1755777600L, "main", false, "GitHub's blurb"));

        List<ProjectResponse> all = allProjects();
        assertThat(all).hasSize(1);
        ProjectResponse draft = all.get(0);

        assertThat(draft.published()).as("an auto-created project is never live").isFalse();
        assertThat(draft.repoFullName()).isEqualTo(repo);
        assertThat(draft.lastPushedAt()).isEqualTo(Instant.ofEpochSecond(1755777600L));
        assertThat(draft.description())
            .as("the placeholder, not GitHub's description")
            .doesNotContain("GitHub's blurb");

        assertThat(publishedProjects())
            .as("the draft must not appear in the public listing")
            .isEmpty();
        assertThatThrownBy(() -> projectService.getPublishedProject(draft.id()))
            .as("nor be readable through the public detail endpoint")
            .isInstanceOf(ResourceNotFoundException.class);
    }

    /**
     * A second delivery for a repository whose draft already exists updates it -- and must not
     * publish it. Nothing but the owner publishes anything.
     */
    @Test
    void aSecondPush_updatesTheDraftWithoutPublishingIt() {
        githubSyncService.accept(UUID.randomUUID().toString(), "push",
            pushPayload(repo, 1755777600L, "main", false, "x"));
        githubSyncService.accept(UUID.randomUUID().toString(), "push",
            pushPayload(repo, 1755864000L, "main", false, "x"));

        List<ProjectResponse> all = allProjects();
        assertThat(all).hasSize(1);
        assertThat(all.get(0).published()).isFalse();
        assertThat(all.get(0).lastPushedAt()).isEqualTo(Instant.ofEpochSecond(1755864000L));
    }

    // -------------------------------------------------------------------------------------
    // The ignore mechanism.
    // -------------------------------------------------------------------------------------

    /**
     * The reason the ADR calls an ignore mechanism required rather than optional: at
     * organisation scope every repository the owner touches would otherwise become a draft, and
     * deleting it does not help because the next push recreates it.
     */
    @Test
    void aPushForARepositoryNotOnTheAllowlist_createsNothing() {
        githubSyncService.accept(UUID.randomUUID().toString(), "push",
            pushPayload("tarka1939/private-experiment", 1755777600L, "main", false, "secret"));

        assertThat(allProjects())
            .as("an unlisted repository must not become a row in the CMS")
            .isEmpty();
    }

    /**
     * The delivery is still recorded, though -- ignoring is a decision about what to write to
     * the Project table, not about whether the webhook was received. Dropping it from the ledger
     * would put a hole in idempotency exactly where the allowlist changes.
     */
    @Test
    void anIgnoredRepositorysDeliveryIsStillRecordedAndStillAcknowledged() {
        String deliveryId = UUID.randomUUID().toString();

        GithubWebhookAck ack = githubSyncService.accept(deliveryId, "push",
            pushPayload("tarka1939/private-experiment", 1755777600L, "main", false, "secret"));

        assertThat(ack.status()).isEqualTo(GithubWebhookAck.Status.RECORDED);
        assertThat(allProjects()).isEmpty();
    }

    // -------------------------------------------------------------------------------------
    // Event types.
    // -------------------------------------------------------------------------------------

    @Test
    void aReleaseSyncsLikeAPushDoes() {
        githubSyncService.accept(UUID.randomUUID().toString(), "release",
            pushPayload(repo, 1755777600L, "main", false, "x"));

        assertThat(allProjects()).hasSize(1);
    }

    /**
     * Anything that is not a push or a release changes no project. An allowlist here for the
     * same reason as the repository one: an event type nobody has thought about should do
     * nothing rather than something.
     */
    @Test
    void aStarEventForAnAllowlistedRepository_createsNothing() {
        githubSyncService.accept(UUID.randomUUID().toString(), "star",
            pushPayload(repo, 1755777600L, "main", false, "x"));

        assertThat(allProjects()).isEmpty();
    }

    /** An organisation-level ping carries no repository at all, and must not fall over. */
    @Test
    void aPingWithNoRepositoryObject_createsNothingAndDoesNotThrow() {
        GithubWebhookAck ack = githubSyncService.accept(
            UUID.randomUUID().toString(), "ping", "{\"zen\": \"Design for failure.\"}"
                .getBytes(StandardCharsets.UTF_8));

        assertThat(ack.status()).isEqualTo(GithubWebhookAck.Status.RECORDED);
        assertThat(allProjects()).isEmpty();
    }

    /**
     * A redelivery publishes no event, so it also syncs nothing a second time. Asserted here
     * rather than only in the idempotency test because the consequence has changed: a duplicate
     * used to be a no-op on an empty seam, and is now a no-op on a write path.
     */
    @Test
    void aRedeliveredDeliveryIdDoesNotSyncTwice() {
        String deliveryId = UUID.randomUUID().toString();
        byte[] payload = pushPayload(repo, 1755777600L, "main", false, "x");

        assertThat(githubSyncService.accept(deliveryId, "push", payload).status())
            .isEqualTo(GithubWebhookAck.Status.RECORDED);
        assertThat(githubSyncService.accept(deliveryId, "push", payload).status())
            .isEqualTo(GithubWebhookAck.Status.DUPLICATE);

        assertThat(allProjects()).hasSize(1);
    }

    // -------------------------------------------------------------------------------------
    // Helpers.
    // -------------------------------------------------------------------------------------

    private ProjectResponse createCuratedProject(String repoFullName) {
        return projectService.createProject(new ProjectWriteRequest(
            "Equalizer",
            "A parametric EQ written in C++, with prose the owner wrote and signed off.",
            List.of(new LinkDto("GitHub", "https://github.com/tarka1939/Equalizer")),
            List.of("https://example.invalid/equalizer.png"),
            List.of("dsp", "cpp"),
            LocalDate.of(2024, 3, 1),
            LocalDate.of(2025, 6, 1),
            null,
            repoFullName));
    }

    private List<ProjectResponse> allProjects() {
        PageResponse<ProjectResponse> page = projectService.listAllProjects(FIRST_PAGE, List.of());
        return page.content();
    }

    private List<ProjectResponse> publishedProjects() {
        return projectService.listPublishedProjects(FIRST_PAGE, List.of()).content();
    }

    /**
     * A payload shaped like GitHub's, including the {@code description} field a naive handler
     * would copy. Built as bytes because that is what the receiver takes -- see
     * {@code GithubSignatureVerifier} on why nothing here re-serialises an object.
     */
    private static byte[] pushPayload(
        String fullName, long pushedAtEpochSeconds, String defaultBranch, boolean archived,
        String description
    ) {
        String json = """
            {
              "ref": "refs/heads/main",
              "repository": {
                "full_name": "%s",
                "description": "%s",
                "pushed_at": %d,
                "default_branch": "%s",
                "archived": %b,
                "private": true
              }
            }
            """.formatted(fullName, description, pushedAtEpochSeconds, defaultBranch, archived);
        return json.getBytes(StandardCharsets.UTF_8);
    }
}
