package io.github.tarka1939.mysite.project;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;

import io.github.tarka1939.mysite.PageResponse;
import io.github.tarka1939.mysite.ResourceNotFoundException;

@ExtendWith(MockitoExtension.class)
class ProjectServiceTest {

    @Mock
    private ProjectRepository projectRepository;

    @Mock
    private TagRepository tagRepository;

    @Mock
    private ApplicationEventPublisher eventPublisher;

    private ProjectService projectService;

    @BeforeEach
    void setUp() {
        projectService = new ProjectService(projectRepository, tagRepository, eventPublisher);
    }

    @Test
    void createProject_savesProjectAndPublishesEvent() {
        ProjectWriteRequest request = new ProjectWriteRequest(
            "Equalizer", "A DSP project", List.of(new LinkDto("GitHub", "https://github.com/x/y")),
            List.of("https://example.com/img.png"), List.of("dsp", "java"), null, null);

        when(tagRepository.findByNameIgnoreCase("dsp")).thenReturn(Optional.of(new Tag("dsp")));
        when(tagRepository.findByNameIgnoreCase("java")).thenReturn(Optional.of(new Tag("java")));
        when(projectRepository.saveAndFlush(any(Project.class))).thenAnswer(invocation -> invocation.getArgument(0));

        ProjectResponse response = projectService.createProject(request);

        assertThat(response.title()).isEqualTo("Equalizer");
        assertThat(response.description()).isEqualTo("A DSP project");
        assertThat(response.tags()).extracting(TagResponse::name).containsExactlyInAnyOrder("dsp", "java");

        verify(tagRepository).upsertByName("dsp");
        verify(tagRepository).upsertByName("java");

        ArgumentCaptor<ProjectCreatedEvent> eventCaptor = ArgumentCaptor.forClass(ProjectCreatedEvent.class);
        verify(eventPublisher).publishEvent(eventCaptor.capture());
        assertThat(eventCaptor.getValue()).isNotNull();
    }

    @Test
    void createProject_upsertsRatherThanCheckThenActToAvoidTagCreationRace() {
        ProjectWriteRequest request = new ProjectWriteRequest(
            "Title", "Description", List.of(), List.of(), List.of("react"), null, null);
        Tag existing = new Tag("React");

        when(tagRepository.findByNameIgnoreCase("react")).thenReturn(Optional.of(existing));
        when(projectRepository.saveAndFlush(any(Project.class))).thenAnswer(invocation -> invocation.getArgument(0));

        projectService.createProject(request);

        // upsertByName is always called (its ON CONFLICT DO NOTHING makes it safe to call
        // even when the tag already exists) rather than branching on a prior find -- that
        // branching is exactly the check-then-act race this replaces.
        verify(tagRepository, times(1)).upsertByName(eq("react"));
    }

    @Test
    void listProjects_withNoTagFilter_usesFindAllIds() {
        UUID projectId = UUID.randomUUID();
        Project project = mock(Project.class);
        lenient().when(project.getId()).thenReturn(projectId);
        lenient().when(project.getTitle()).thenReturn("Title");
        lenient().when(project.getDescription()).thenReturn("Description");
        lenient().when(project.getLinks()).thenReturn(List.of());
        lenient().when(project.getImages()).thenReturn(new String[0]);
        lenient().when(project.getTags()).thenReturn(java.util.Set.of());

        Pageable pageable = PageRequest.of(0, 20);
        when(projectRepository.findAllIds(pageable)).thenReturn(new PageImpl<>(List.of(projectId), pageable, 1));
        when(projectRepository.findAllById(List.of(projectId))).thenReturn(List.of(project));

        PageResponse<ProjectResponse> response = projectService.listProjects(pageable, List.of());

        assertThat(response.content()).hasSize(1);
        assertThat(response.content().get(0).id()).isEqualTo(projectId);
        assertThat(response.totalElements()).isEqualTo(1);
    }

    @Test
    void listProjects_withTagFilter_lowercasesTagNamesAndUsesFilteredQuery() {
        Pageable pageable = PageRequest.of(0, 20);
        when(projectRepository.findIdsByTagNamesIgnoreCase(List.of("react"), pageable))
            .thenReturn(new PageImpl<>(List.of(), pageable, 0));

        projectService.listProjects(pageable, List.of("React"));

        verify(projectRepository).findIdsByTagNamesIgnoreCase(eq(List.of("react")), eq(pageable));
    }

    @Test
    void getProject_whenMissing_throwsResourceNotFoundException() {
        UUID id = UUID.randomUUID();
        when(projectRepository.findById(id)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> projectService.getProject(id))
            .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void updateProject_usesSaveAndFlushSoTimestampsArePopulated() {
        UUID id = UUID.randomUUID();
        Project existing = new Project("Old title", "Old description");
        when(projectRepository.findById(id)).thenReturn(Optional.of(existing));
        when(tagRepository.findByNameIgnoreCase("dsp")).thenReturn(Optional.of(new Tag("dsp")));
        when(projectRepository.saveAndFlush(any(Project.class))).thenAnswer(invocation -> invocation.getArgument(0));

        ProjectWriteRequest request = new ProjectWriteRequest(
            "New title", "New description", List.of(), List.of(), List.of("dsp"), null, null);

        ProjectResponse response = projectService.updateProject(id, request);

        assertThat(response.title()).isEqualTo("New title");
        assertThat(response.description()).isEqualTo("New description");
        verify(projectRepository).saveAndFlush(existing);
    }

    @Test
    void createProject_mapsTheDatePeriodOntoTheEntity() {
        ProjectWriteRequest request = new ProjectWriteRequest(
            "Equalizer", "A DSP project", List.of(), List.of(), List.of(),
            LocalDate.of(2024, 3, 1), LocalDate.of(2025, 6, 1));
        when(projectRepository.saveAndFlush(any(Project.class))).thenAnswer(invocation -> invocation.getArgument(0));

        ProjectResponse response = projectService.createProject(request);

        assertThat(response.startedOn()).isEqualTo(LocalDate.of(2024, 3, 1));
        assertThat(response.completedOn()).isEqualTo(LocalDate.of(2025, 6, 1));
    }

    @Test
    void updateProject_withOmittedDates_clearsThemRatherThanPreservingStoredValues() {
        // PUT is a full replacement (docs/openapi.yaml's ProjectWriteRequest), so a null
        // incoming date must be written through. Guarding against the tempting
        // "if (request.startedOn() != null)" variant, which would make dates un-clearable.
        UUID id = UUID.randomUUID();
        Project existing = new Project("Old title", "Old description");
        existing.setStartedOn(LocalDate.of(2024, 3, 1));
        existing.setCompletedOn(LocalDate.of(2025, 6, 1));
        when(projectRepository.findById(id)).thenReturn(Optional.of(existing));
        when(projectRepository.saveAndFlush(any(Project.class))).thenAnswer(invocation -> invocation.getArgument(0));

        ProjectResponse response = projectService.updateProject(id, new ProjectWriteRequest(
            "New title", "New description", List.of(), List.of(), List.of(), null, null));

        assertThat(response.startedOn()).isNull();
        assertThat(response.completedOn()).isNull();
        assertThat(existing.getStartedOn()).isNull();
        assertThat(existing.getCompletedOn()).isNull();
    }

    @Test
    void updateProject_whenMissing_throwsResourceNotFoundException() {
        UUID id = UUID.randomUUID();
        when(projectRepository.findById(id)).thenReturn(Optional.empty());
        ProjectWriteRequest request = new ProjectWriteRequest("T", "D", List.of(), List.of(), List.of(), null, null);

        assertThatThrownBy(() -> projectService.updateProject(id, request))
            .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void deleteProject_whenPresent_deletesIt() {
        UUID id = UUID.randomUUID();
        Project existing = new Project("Title", "Description");
        when(projectRepository.findById(id)).thenReturn(Optional.of(existing));

        projectService.deleteProject(id);

        verify(projectRepository).delete(existing);
    }

    @Test
    void deleteProject_whenMissing_throwsResourceNotFoundException() {
        UUID id = UUID.randomUUID();
        when(projectRepository.findById(id)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> projectService.deleteProject(id))
            .isInstanceOf(ResourceNotFoundException.class);
    }
}
