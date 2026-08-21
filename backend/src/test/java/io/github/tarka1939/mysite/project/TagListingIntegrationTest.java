package io.github.tarka1939.mysite.project;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

import jakarta.persistence.EntityManager;

/**
 * GET /tags returns only tags attached to at least one project (issue #124) — the listing
 * populates the public "filter by tag" control, so a tag matching zero projects is a filter
 * value that leads nowhere.
 *
 * <p>Real Postgres via Testcontainers rather than mocks, for the same reasons as
 * {@link ProjectRepositoryIntegrationTest}: the filter lives in a native query against
 * {@code project_tags}, so a mocked repository would assert nothing about the behaviour under
 * test. Migrations V1 through V5 run, V5 being the index this query's WHERE column needs.
 *
 * <p>{@code @Transactional} rolls each test back, so every method starts with an empty
 * {@code tag} table — which is what lets the assertions below use {@code containsExactly} over
 * the whole listing rather than fishing for individual names.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.NONE)
@Testcontainers
@ActiveProfiles("test")
@Transactional
class TagListingIntegrationTest {

    @Container
    @ServiceConnection
    static PostgreSQLContainer postgres = new PostgreSQLContainer("postgres:17-alpine");

    @Autowired
    private TagRepository tagRepository;

    @Autowired
    private TagService tagService;

    @Autowired
    private ProjectService projectService;

    @Autowired
    private EntityManager entityManager;

    @Test
    void tagWithNoProjectIsExcluded() {
        // Exactly how the six live orphans got there: a tag row outliving every project that
        // referenced it. Saved directly, since there is no way to create an unattached tag
        // through the API — which is the whole reason they are invisible until the filter
        // control renders one.
        tagRepository.saveAndFlush(new Tag("orphan"));

        assertThat(tagService.listTags()).extracting(TagResponse::name).doesNotContain("orphan");
    }

    @Test
    void tagWithAtLeastOneProjectIsIncluded() {
        createProject("Equalizer", List.of("dsp"));

        assertThat(tagService.listTags()).extracting(TagResponse::name).contains("dsp");
    }

    @Test
    void tagWithNoProjectIsExcludedWhileAnAttachedOneSurvivesTheSameCall() {
        // Both cases in one listing: a filter that excluded everything, or nothing, would
        // satisfy one of the two tests above on its own but cannot satisfy this one.
        tagRepository.saveAndFlush(new Tag("orphan"));
        createProject("Equalizer", List.of("dsp"));

        assertThat(tagService.listTags()).extracting(TagResponse::name).containsExactly("dsp");
    }

    @Test
    void tagDropsOutWhenItsLastProjectIsDeletedAndComesBackWhenAnotherReattachesIt() {
        // The behaviour that makes filtering the read side sufficient, and the reason no
        // orphan cleanup is needed: the listing is derived, so it self-corrects in both
        // directions without anything ever deleting a tag row.
        ProjectResponse first = createProject("Equalizer", List.of("dsp"));
        UUID tagId = tagRepository.findByNameIgnoreCase("dsp").orElseThrow().getId();
        assertThat(tagService.listTags()).extracting(TagResponse::name).containsExactly("dsp");

        projectService.deleteProject(first.id());
        // delete() only stages the removal in the persistence context; the native listing
        // query reads the database, so the pending delete has to reach it first.
        flushAndClear();

        assertThat(tagService.listTags()).extracting(TagResponse::name).doesNotContain("dsp");
        // The row itself is still there — it is filtered out, not cleaned up. If this ever
        // starts failing, something has begun deleting orphans, and the concurrency argument
        // in TagRepository#findAllInUseOrderByNameAsc needs revisiting rather than this line.
        assertThat(tagRepository.findByNameIgnoreCase("dsp")).isPresent();

        createProject("Reverb", List.of("dsp"));
        flushAndClear();

        assertThat(tagService.listTags()).extracting(TagResponse::name).containsExactly("dsp");
        // Reattached the same row rather than creating a second "dsp" — the upsert did not
        // have to work around a deleted row, which is exactly what not deleting buys.
        assertThat(tagService.listTags()).extracting(TagResponse::id).containsExactly(tagId);
    }

    @Test
    void tagSharedByTwoProjectsSurvivesTheDeletionOfOneOfThem() {
        // "At least one", not "exactly one": the tag only drops out when its LAST reference
        // goes. A filter written as a count-equals or a not-exists inversion fails here.
        ProjectResponse first = createProject("Equalizer", List.of("shared"));
        createProject("Reverb", List.of("shared"));

        projectService.deleteProject(first.id());
        flushAndClear();

        assertThat(tagService.listTags()).extracting(TagResponse::name).containsExactly("shared");
    }

    @Test
    void listingIsOrderedByNameAscending() {
        // Created in deliberately non-alphabetical order: an unordered query returns heap
        // order, which here is insertion order, so dropping the ORDER BY fails this. "middle"
        // is an orphan and sorts between the other two, so dropping the filter fails it too.
        createProject("Zebra project", List.of("zebra"));
        tagRepository.saveAndFlush(new Tag("middle"));
        createProject("Alpha project", List.of("alpha"));

        assertThat(tagService.listTags()).extracting(TagResponse::name)
            .containsExactly("alpha", "zebra");
    }

    private ProjectResponse createProject(String title, List<String> tags) {
        ProjectResponse created = projectService.createProject(new ProjectWriteRequest(
            title, "Description of " + title, List.of(), List.of(), tags, null, null, null, null));
        entityManager.flush();
        return created;
    }

    private void flushAndClear() {
        entityManager.flush();
        entityManager.clear();
    }
}
