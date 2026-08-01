package io.github.tarka1939.mysite.project;

import java.util.HashSet;
import java.util.List;
import java.util.Set;

import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Phase 1 scope: create only, to prove out the controller-service-repository layering and
 * the {@link ProjectCreatedEvent} publish example. Read/update/delete, pagination, and tag
 * filtering are Phase 2 (Project CRUD) work — deliberately not built here.
 */
@Service
public class ProjectService {

    private final ProjectRepository projectRepository;
    private final TagRepository tagRepository;
    private final ApplicationEventPublisher eventPublisher;

    public ProjectService(
        ProjectRepository projectRepository,
        TagRepository tagRepository,
        ApplicationEventPublisher eventPublisher
    ) {
        this.projectRepository = projectRepository;
        this.tagRepository = tagRepository;
        this.eventPublisher = eventPublisher;
    }

    @Transactional
    public ProjectResponse createProject(ProjectWriteRequest request) {
        Project project = new Project(request.title(), request.description());
        project.setLinks(request.links().stream().map(l -> new Link(l.label(), l.url())).toList());
        project.setImages(request.images().toArray(new String[0]));
        project.setTags(resolveTags(request.tags()));

        Project saved = projectRepository.save(project);
        eventPublisher.publishEvent(new ProjectCreatedEvent(saved.getId()));
        return ProjectResponse.from(saved);
    }

    private Set<Tag> resolveTags(List<String> tagNames) {
        Set<Tag> tags = new HashSet<>();
        for (String name : tagNames) {
            Tag tag = tagRepository.findByNameIgnoreCase(name)
                .orElseGet(() -> tagRepository.save(new Tag(name)));
            tags.add(tag);
        }
        return tags;
    }
}
