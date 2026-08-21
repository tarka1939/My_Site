package io.github.tarka1939.mysite.project;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.LocalDate;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

import io.github.tarka1939.mysite.PageResponse;
import io.github.tarka1939.mysite.ResourceNotFoundException;

import jakarta.persistence.EntityManager;

/**
 * Boots the full application context against a real Postgres via Testcontainers, running the
 * real Flyway migrations (V1__init.sql through V4__project_dates.sql) — H2-in-tests would
 * pass jsonb/text[] mapping bugs, and would not enforce V4's CHECK constraint the way
 * Postgres does. See PROJECT_TODO.md's Phase 1 Testcontainers item.
 *
 * {@code @Transactional} keeps each test in one persistence context (matching how
 * ProjectService's real @Transactional methods behave) and rolls back after each test.
 *
 * {@code @ActiveProfiles("test")} resolves app.jwt.secret (application-test.yml) for the
 * SecurityConfig beans that now boot as part of every full application context.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.NONE)
@Testcontainers
@ActiveProfiles("test")
@Transactional
class ProjectRepositoryIntegrationTest {

    @Container
    @ServiceConnection
    static PostgreSQLContainer postgres = new PostgreSQLContainer("postgres:17-alpine");

    @Autowired
    private ProjectRepository projectRepository;

    @Autowired
    private TagRepository tagRepository;

    @Autowired
    private ProjectService projectService;

    @Autowired
    private EntityManager entityManager;

    @Test
    void savesAndReloadsProjectWithJsonbLinksAndTextArrayImages() {
        Project project = new Project("Equalizer", "A DSP project");
        project.setLinks(List.of(new Link("GitHub", "https://github.com/x/y")));
        project.setImages(new String[] {"https://example.com/a.png", "https://example.com/b.png"});
        project.setTags(Set.of(tagRepository.save(new Tag("dsp"))));

        UUID id = projectRepository.saveAndFlush(project).getId();
        entityManager.clear();

        Project reloaded = projectRepository.findById(id).orElseThrow();

        assertThat(reloaded.getLinks()).containsExactly(new Link("GitHub", "https://github.com/x/y"));
        assertThat(reloaded.getImages()).containsExactly(
            "https://example.com/a.png", "https://example.com/b.png");
        assertThat(reloaded.getTags()).extracting(Tag::getName).containsExactly("dsp");
        assertThat(reloaded.getCreatedAt()).isNotNull();
        assertThat(reloaded.getUpdatedAt()).isNotNull();
    }

    @Test
    void createProjectThroughService_populatesTimestampsInResponse() {
        // Regression guard: ProjectService must saveAndFlush (not save) so Hibernate's
        // @CreationTimestamp/@UpdateTimestamp generators have run before the response DTO
        // is built — a plain save() defers that flush to commit, after the method returns,
        // and a mock-based unit test can't catch it since mocks don't simulate flush timing.
        ProjectWriteRequest request = new ProjectWriteRequest(
            "Equalizer", "A DSP project", List.of(), List.of(), List.of("dsp"), null, null, null, null);

        ProjectResponse response = projectService.createProject(request);

        assertThat(response.createdAt()).isNotNull();
        assertThat(response.updatedAt()).isNotNull();
    }

    @Test
    void tagNameUniquenessIsCaseInsensitive() {
        tagRepository.saveAndFlush(new Tag("React"));

        assertThatThrownBy(() -> tagRepository.saveAndFlush(new Tag("react")))
            .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    void upsertByNameIsIdempotentAndCaseInsensitive() {
        tagRepository.upsertByName("Vue");
        tagRepository.upsertByName("vue");
        tagRepository.upsertByName("VUE");

        List<Tag> matches = tagRepository.findAll().stream()
            .filter(t -> t.getName().equalsIgnoreCase("vue"))
            .toList();
        assertThat(matches).hasSize(1);
        assertThat(matches.get(0).getName()).isEqualTo("Vue");
    }

    @Test
    void listProjects_withoutTagFilter_returnsAllProjectsPaginated() {
        createProject("Alpha", List.of("dsp"));
        createProject("Beta", List.of("java"));
        createProject("Gamma", List.of("dsp", "java"));

        PageResponse<ProjectResponse> firstPage = projectService.listAllProjects(sortedPage(0, 2), List.of());

        assertThat(firstPage.totalElements()).isEqualTo(3);
        assertThat(firstPage.totalPages()).isEqualTo(2);
        assertThat(firstPage.content()).hasSize(2);
    }

    @Test
    void listProjects_withTagFilter_appliesOrSemanticsAndDoesNotDuplicateMultiTagMatches() {
        createProject("Alpha", List.of("dsp"));
        createProject("Beta", List.of("java"));
        createProject("Gamma", List.of("dsp", "java"));
        createProject("Delta", List.of("react"));

        // Sorted, not PageRequest.of(0, 10) unsorted -- ProjectController always builds a
        // createdAt-sorted Pageable, and a plain SELECT DISTINCT p.id combined with an ORDER
        // BY column outside the select list is exactly the combination Postgres rejects
        // ("for SELECT DISTINCT, ORDER BY expressions must appear in select list"). An
        // unsorted Pageable here would silently not exercise that path -- this is a real
        // regression test for a bug manual `curl` verification caught that this integration
        // suite originally missed.
        PageResponse<ProjectResponse> page = projectService.listAllProjects(
            sortedPage(0, 10), List.of("dsp", "java"));

        // Gamma has BOTH tags -- must appear once, not twice, despite matching the tag
        // subquery twice.
        assertThat(page.totalElements()).isEqualTo(3);
        assertThat(page.content()).extracting(ProjectResponse::title)
            .containsExactlyInAnyOrder("Alpha", "Beta", "Gamma");
    }

    @Test
    void listProjects_tagFilterIsCaseInsensitive() {
        createProject("Alpha", List.of("React"));

        PageResponse<ProjectResponse> page = projectService.listAllProjects(sortedPage(0, 10), List.of("react"));

        assertThat(page.totalElements()).isEqualTo(1);
    }

    @Test
    void updateProject_bumpsUpdatedAtAndReplacesTagsAndFields() throws InterruptedException {
        ProjectResponse created = createProject("Original title", List.of("dsp"));

        // Postgres timestamptz has microsecond resolution but the two writes can otherwise
        // land in the same millisecond on a fast CI box -- force a visible gap so the
        // updatedAt-bump assertion below can't pass by timing coincidence.
        Thread.sleep(5);

        ProjectWriteRequest updateRequest = new ProjectWriteRequest(
            "Updated title", "Updated description", List.of(), List.of(), List.of("java"), null, null, null, null);
        ProjectResponse updated = projectService.updateProject(created.id(), updateRequest);

        assertThat(updated.title()).isEqualTo("Updated title");
        assertThat(updated.description()).isEqualTo("Updated description");
        assertThat(updated.tags()).extracting(TagResponse::name).containsExactly("java");
        assertThat(updated.updatedAt()).isAfter(created.updatedAt());
        assertThat(updated.createdAt()).isEqualTo(created.createdAt());
    }

    @Test
    void updateProject_whenIdDoesNotExist_throwsResourceNotFoundException() {
        ProjectWriteRequest request = new ProjectWriteRequest("T", "D", List.of(), List.of(), List.of(), null, null, null, null);

        assertThatThrownBy(() -> projectService.updateProject(UUID.randomUUID(), request))
            .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void deleteProject_removesProjectAndItsTagAssociations_butNotTheTagsThemselves() {
        ProjectResponse created = createProject("Deletable", List.of("shared-tag"));
        entityManager.clear();

        projectService.deleteProject(created.id());
        // repository.delete() only stages the removal in the persistence context; it's flushed
        // to the DB at transaction commit in real request handling, but this test re-queries
        // within the SAME still-open transaction, so it needs an explicit flush first --
        // entityManager.clear() alone would just discard the pending delete, not apply it.
        entityManager.flush();
        entityManager.clear();

        assertThat(projectRepository.findById(created.id())).isEmpty();
        assertThat(tagRepository.findByNameIgnoreCase("shared-tag")).isPresent();
    }

    @Test
    void deleteProject_whenIdDoesNotExist_throwsResourceNotFoundException() {
        assertThatThrownBy(() -> projectService.deleteProject(UUID.randomUUID()))
            .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void getProject_whenIdDoesNotExist_throwsResourceNotFoundException() {
        assertThatThrownBy(() -> projectService.getProject(UUID.randomUUID()))
            .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void createProject_withAFullDatePeriod_roundTripsBothDates() {
        ProjectResponse created = projectService.createProject(new ProjectWriteRequest(
            "Equalizer", "A DSP project", List.of(), List.of(), List.of("dsp"),
            LocalDate.of(2024, 3, 1), LocalDate.of(2025, 6, 1), null, null));
        entityManager.clear();

        Project reloaded = projectRepository.findById(created.id()).orElseThrow();

        assertThat(created.startedOn()).isEqualTo(LocalDate.of(2024, 3, 1));
        assertThat(created.completedOn()).isEqualTo(LocalDate.of(2025, 6, 1));
        assertThat(reloaded.getStartedOn()).isEqualTo(LocalDate.of(2024, 3, 1));
        assertThat(reloaded.getCompletedOn()).isEqualTo(LocalDate.of(2025, 6, 1));
    }

    @Test
    void createProject_withStartedOnOnly_storesAnOngoingProject() {
        ProjectResponse created = projectService.createProject(new ProjectWriteRequest(
            "Ongoing", "Still being worked on", List.of(), List.of(), List.of("dsp"),
            LocalDate.of(2026, 2, 1), null, null, null));
        entityManager.clear();

        Project reloaded = projectRepository.findById(created.id()).orElseThrow();

        assertThat(created.startedOn()).isEqualTo(LocalDate.of(2026, 2, 1));
        assertThat(created.completedOn()).isNull();
        assertThat(reloaded.getCompletedOn()).isNull();
    }

    @Test
    void createProject_withNoDates_leavesBothColumnsNull() {
        // Absence is its own case: the columns are nullable and nothing (no DB default, no
        // fallback to created_at) may quietly fill them in.
        ProjectResponse created = createProject("Undated", List.of("dsp"));
        entityManager.clear();

        Project reloaded = projectRepository.findById(created.id()).orElseThrow();

        assertThat(created.startedOn()).isNull();
        assertThat(created.completedOn()).isNull();
        assertThat(reloaded.getStartedOn()).isNull();
        assertThat(reloaded.getCompletedOn()).isNull();
    }

    @Test
    void updateProject_omittingDates_clearsPreviouslyStoredOnes() {
        // PUT is a full replacement (docs/openapi.yaml's ProjectWriteRequest): omitting a
        // date clears it rather than preserving the stored value.
        ProjectResponse created = projectService.createProject(new ProjectWriteRequest(
            "Dated", "Has a period", List.of(), List.of(), List.of("dsp"),
            LocalDate.of(2024, 3, 1), LocalDate.of(2025, 6, 1), null, null));

        ProjectResponse updated = projectService.updateProject(created.id(), new ProjectWriteRequest(
            "Dated", "Period removed", List.of(), List.of(), List.of("dsp"), null, null, null, null));
        entityManager.flush();
        entityManager.clear();

        assertThat(updated.startedOn()).isNull();
        assertThat(updated.completedOn()).isNull();
        Project reloaded = projectRepository.findById(created.id()).orElseThrow();
        assertThat(reloaded.getStartedOn()).isNull();
        assertThat(reloaded.getCompletedOn()).isNull();
    }

    @Test
    void updateProject_canCloseOutAnOngoingProject() {
        ProjectResponse created = projectService.createProject(new ProjectWriteRequest(
            "Ongoing", "Not finished yet", List.of(), List.of(), List.of("dsp"),
            LocalDate.of(2024, 3, 1), null, null, null));

        ProjectResponse updated = projectService.updateProject(created.id(), new ProjectWriteRequest(
            "Ongoing", "Now finished", List.of(), List.of(), List.of("dsp"),
            LocalDate.of(2024, 3, 1), LocalDate.of(2025, 6, 1), null, null));

        assertThat(updated.completedOn()).isEqualTo(LocalDate.of(2025, 6, 1));
    }

    // --- ck_project_date_period: the defence-in-depth layer, exercised against real Postgres.
    // These bypass ProjectWriteRequest entirely (the DTO validation is what the API relies on;
    // this is what holds for a psql session, a bulk import or a future migration). One
    // violating write per test method -- a failed statement dooms the surrounding transaction,
    // so two in one method would fail for the wrong reason.

    @Test
    void databaseRejectsCompletedOnBeforeStartedOn() {
        Project project = new Project("Backwards", "Ends before it begins");
        project.setStartedOn(LocalDate.of(2025, 6, 1));
        project.setCompletedOn(LocalDate.of(2024, 3, 1));

        assertThatThrownBy(() -> projectRepository.saveAndFlush(project))
            .isInstanceOf(DataIntegrityViolationException.class)
            .hasMessageContaining("ck_project_date_period");
    }

    @Test
    void databaseRejectsCompletedOnWithoutStartedOn() {
        // The three-valued-logic case: a naive `completed_on >= started_on` CHECK evaluates
        // to NULL here and would therefore be *satisfied*, letting the row through.
        Project project = new Project("Finished but never started", "Impossible");
        project.setCompletedOn(LocalDate.of(2024, 3, 1));

        assertThatThrownBy(() -> projectRepository.saveAndFlush(project))
            .isInstanceOf(DataIntegrityViolationException.class)
            .hasMessageContaining("ck_project_date_period");
    }

    // The three permitted cases below clear the persistence context and read the row back, the
    // same way the createProject_* tests above do. Asserting on what saveAndFlush returns would
    // be asserting on the very instance that was handed in -- true before the write, and true
    // even if the value never reached Postgres. The flush is what proves the CHECK does not
    // fire; the re-read is what gives the assertions something they can fail on.

    @Test
    void databasePermitsBothDatesNull() {
        UUID id = projectRepository.saveAndFlush(new Project("Undated", "No period at all")).getId();
        entityManager.clear();

        Project reloaded = projectRepository.findById(id).orElseThrow();

        assertThat(reloaded.getStartedOn()).isNull();
        assertThat(reloaded.getCompletedOn()).isNull();
    }

    @Test
    void databasePermitsStartedOnWithoutCompletedOn() {
        Project project = new Project("Ongoing", "Still going");
        project.setStartedOn(LocalDate.of(2026, 2, 1));
        UUID id = projectRepository.saveAndFlush(project).getId();
        entityManager.clear();

        Project reloaded = projectRepository.findById(id).orElseThrow();

        assertThat(reloaded.getStartedOn()).isEqualTo(LocalDate.of(2026, 2, 1));
        assertThat(reloaded.getCompletedOn()).isNull();
    }

    @Test
    void databasePermitsAStartAndCompletionOnTheSameDay() {
        Project project = new Project("Weekend build", "Same-day period");
        project.setStartedOn(LocalDate.of(2024, 3, 1));
        project.setCompletedOn(LocalDate.of(2024, 3, 1));
        UUID id = projectRepository.saveAndFlush(project).getId();
        entityManager.clear();

        Project reloaded = projectRepository.findById(id).orElseThrow();

        assertThat(reloaded.getStartedOn()).isEqualTo(LocalDate.of(2024, 3, 1));
        assertThat(reloaded.getCompletedOn()).isEqualTo(LocalDate.of(2024, 3, 1));
    }

    private ProjectResponse createProject(String title, List<String> tags) {
        ProjectWriteRequest request = new ProjectWriteRequest(
            title, "Description of " + title, List.of(), List.of(), tags, null, null, null, null);
        return projectService.createProject(request);
    }

    /** Matches ProjectController's actual Pageable shape -- see the comment on the tag-filter test above. */
    private Pageable sortedPage(int page, int size) {
        return PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "createdAt"));
    }
}
