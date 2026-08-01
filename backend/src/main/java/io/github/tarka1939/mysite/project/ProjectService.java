package io.github.tarka1939.mysite.project;

import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import org.springframework.context.ApplicationEventPublisher;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import io.github.tarka1939.mysite.PageResponse;
import io.github.tarka1939.mysite.ResourceNotFoundException;

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

        // saveAndFlush (not save): @CreationTimestamp/@UpdateTimestamp are populated by
        // Hibernate at flush time. A plain save() defers that flush to transaction commit,
        // which happens after this method returns — the response DTO would see null
        // createdAt/updatedAt otherwise.
        Project saved = projectRepository.saveAndFlush(project);
        eventPublisher.publishEvent(new ProjectCreatedEvent(saved.getId()));
        return ProjectResponse.from(saved);
    }

    @Transactional(readOnly = true)
    public PageResponse<ProjectResponse> listProjects(Pageable pageable, List<String> tagNames) {
        Page<UUID> idPage = (tagNames == null || tagNames.isEmpty())
            ? projectRepository.findAllIds(pageable)
            : projectRepository.findIdsByTagNamesIgnoreCase(tagNames.stream().map(String::toLowerCase).toList(), pageable);

        Map<UUID, Project> byId = new HashMap<>();
        projectRepository.findAllById(idPage.getContent()).forEach(p -> byId.put(p.getId(), p));

        // byId.get(id) can miss if a project was deleted between the id query above and
        // findAllById -- filter rather than let ProjectResponse.from(null) NPE into a 500 for
        // what's a normal (if rare) concurrent-delete race, not an error condition.
        List<ProjectResponse> content = idPage.getContent().stream()
            .map(byId::get)
            .filter(java.util.Objects::nonNull)
            .map(ProjectResponse::from)
            .toList();

        return PageResponse.from(idPage, content);
    }

    @Transactional(readOnly = true)
    public ProjectResponse getProject(UUID id) {
        return ProjectResponse.from(findProjectOrThrow(id));
    }

    @Transactional
    public ProjectResponse updateProject(UUID id, ProjectWriteRequest request) {
        Project project = findProjectOrThrow(id);
        project.setTitle(request.title());
        project.setDescription(request.description());
        project.setLinks(request.links().stream().map(l -> new Link(l.label(), l.url())).toList());
        project.setImages(request.images().toArray(new String[0]));
        project.setTags(resolveTags(request.tags()));

        // saveAndFlush for the same reason as createProject: @UpdateTimestamp only bumps at
        // flush time, and this endpoint (unlike create) is exactly the one flagged in the
        // Phase 2 kickoff as likely to reintroduce the null-timestamp bug if this is missed.
        Project saved = projectRepository.saveAndFlush(project);
        return ProjectResponse.from(saved);
    }

    @Transactional
    public void deleteProject(UUID id) {
        Project project = findProjectOrThrow(id);
        projectRepository.delete(project);
    }

    private Project findProjectOrThrow(UUID id) {
        return projectRepository.findById(id)
            .orElseThrow(() -> new ResourceNotFoundException("Project not found: " + id));
    }

    private Set<Tag> resolveTags(List<String> tagNames) {
        Set<Tag> tags = new HashSet<>();
        for (String name : tagNames) {
            // upsertByName + re-fetch (not findOrElseSave) to avoid a check-then-act race:
            // two concurrent requests creating the same new tag would otherwise both miss
            // the find and both attempt to insert, tripping ux_tag_name_lower on one of them.
            tagRepository.upsertByName(name);
            Tag tag = tagRepository.findByNameIgnoreCase(name).orElseThrow(
                () -> new IllegalStateException("Tag upsert should guarantee existence: " + name));
            tags.add(tag);
        }
        return tags;
    }
}
