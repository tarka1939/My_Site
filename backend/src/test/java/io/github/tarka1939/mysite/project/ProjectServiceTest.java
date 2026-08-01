package io.github.tarka1939.mysite.project;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.List;
import java.util.Optional;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.context.ApplicationEventPublisher;

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
            List.of("https://example.com/img.png"), List.of("dsp", "java"));

        when(tagRepository.findByNameIgnoreCase("dsp")).thenReturn(Optional.of(new Tag("dsp")));
        when(tagRepository.findByNameIgnoreCase("java")).thenReturn(Optional.empty());
        when(tagRepository.save(any(Tag.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(projectRepository.save(any(Project.class))).thenAnswer(invocation -> invocation.getArgument(0));

        ProjectResponse response = projectService.createProject(request);

        assertThat(response.title()).isEqualTo("Equalizer");
        assertThat(response.description()).isEqualTo("A DSP project");
        assertThat(response.tags()).extracting(TagResponse::name).containsExactlyInAnyOrder("dsp", "java");

        ArgumentCaptor<ProjectCreatedEvent> eventCaptor = ArgumentCaptor.forClass(ProjectCreatedEvent.class);
        verify(eventPublisher).publishEvent(eventCaptor.capture());
        assertThat(eventCaptor.getValue()).isNotNull();
    }

    @Test
    void createProject_reusesExistingTagInsteadOfDuplicating() {
        ProjectWriteRequest request = new ProjectWriteRequest(
            "Title", "Description", List.of(), List.of(), List.of("react"));
        Tag existing = new Tag("React");

        when(tagRepository.findByNameIgnoreCase("react")).thenReturn(Optional.of(existing));
        when(projectRepository.save(any(Project.class))).thenAnswer(invocation -> invocation.getArgument(0));

        projectService.createProject(request);

        verify(tagRepository, org.mockito.Mockito.never()).save(any(Tag.class));
    }
}
