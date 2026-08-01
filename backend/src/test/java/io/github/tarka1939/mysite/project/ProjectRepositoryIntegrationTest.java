package io.github.tarka1939.mysite.project;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import java.util.Set;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.transaction.annotation.Transactional;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import jakarta.persistence.EntityManager;

/**
 * Boots the full application context against a real Postgres via Testcontainers, running
 * the real V1__init.sql Flyway migration — H2-in-tests would pass jsonb/text[] mapping bugs
 * that only surface against real Postgres. See PROJECT_TODO.md's Phase 1 Testcontainers item.
 *
 * {@code @Transactional} keeps each test in one persistence context (matching how
 * ProjectService's real @Transactional methods behave) and rolls back after each test.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.NONE)
@Testcontainers
@Transactional
class ProjectRepositoryIntegrationTest {

    @Container
    @ServiceConnection
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:17-alpine");

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
            "Equalizer", "A DSP project", List.of(), List.of(), List.of("dsp"));

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
}
