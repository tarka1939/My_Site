package io.github.tarka1939.mysite.project;

import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

import org.springframework.context.ApplicationEventPublisher;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import io.github.tarka1939.mysite.DuplicateRepoFullNameException;
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

    /**
     * The placeholder description an auto-created draft arrives with. Deliberately not the
     * repository's GitHub description: the Phase 7a ADR's first rule is that sync never writes a
     * curated field, and the rule is unconditional rather than "except when the field is empty",
     * so a later change cannot widen it into the update path. This text is also the more useful
     * thing to show, since it says what the owner has to do next.
     *
     * <p>Only ever seen in the admin UI -- a draft is not on the public site.
     */
    static String placeholderDescriptionFor(String repoFullName) {
        return "Draft created automatically from the GitHub repository " + repoFullName
            + ". Write a description here before publishing it.";
    }

    @Transactional
    public ProjectResponse createProject(ProjectWriteRequest request) {
        Project project = new Project(request.title(), request.description());
        project.setLinks(request.links().stream().map(l -> new Link(l.label(), l.url())).toList());
        project.setImages(request.images().toArray(new String[0]));
        project.setTags(resolveTags(request.tags()));
        project.setStartedOn(request.startedOn());
        project.setCompletedOn(request.completedOn());
        // Absent means published, which is what POST has always done -- see
        // ProjectWriteRequest.published for why the two verbs read the same silence differently.
        project.setPublished(request.published() == null || request.published());
        if (request.repoFullName() != null) {
            requireRepoFullNameUnclaimed(request.repoFullName(), null);
            project.setRepoFullName(request.repoFullName());
        }

        // saveAndFlush (not save): @CreationTimestamp/@UpdateTimestamp are populated by
        // Hibernate at flush time. A plain save() defers that flush to transaction commit,
        // which happens after this method returns — the response DTO would see null
        // createdAt/updatedAt otherwise.
        Project saved = projectRepository.saveAndFlush(project);
        eventPublisher.publishEvent(new ProjectCreatedEvent(saved.getId()));
        return ProjectResponse.from(saved);
    }

    /**
     * The public listing: published projects only, and nothing the caller sends changes that.
     *
     * <p>Its own method calling its own query rather than a {@code publishedOnly} flag shared
     * with {@link #listAllProjects} -- see ProjectRepository's note. The site's most public
     * surface should not be one boolean away from serving the owner's drafts, which since Phase
     * 7a can be auto-created from private repositories.
     */
    @Transactional(readOnly = true)
    public PageResponse<ProjectResponse> listPublishedProjects(Pageable pageable, List<String> tagNames) {
        return toPageResponse(hasTagFilter(tagNames)
            ? projectRepository.findPublishedIdsByTagNamesIgnoreCase(lowercased(tagNames), pageable)
            : projectRepository.findPublishedIds(pageable));
    }

    /**
     * The admin listing: everything, drafts included, behind {@code hasRole('ADMIN')} on
     * {@link AdminProjectController}. Same paging and tag filtering as the public one.
     */
    @Transactional(readOnly = true)
    public PageResponse<ProjectResponse> listAllProjects(Pageable pageable, List<String> tagNames) {
        return toPageResponse(hasTagFilter(tagNames)
            ? projectRepository.findIdsByTagNamesIgnoreCase(lowercased(tagNames), pageable)
            : projectRepository.findAllIds(pageable));
    }

    /**
     * The public detail read. An unpublished project throws the same
     * {@link ResourceNotFoundException} an unknown id does, so it answers 404 and not 403: a 403
     * would confirm that the id names a real project, which is the one fact a draft is
     * withholding. See docs/openapi.yaml.
     */
    @Transactional(readOnly = true)
    public ProjectResponse getPublishedProject(UUID id) {
        return ProjectResponse.from(projectRepository.findByIdAndPublishedTrue(id)
            .orElseThrow(() -> new ResourceNotFoundException("Project not found: " + id)));
    }

    /** The admin detail read: any project, draft or not. */
    @Transactional(readOnly = true)
    public ProjectResponse getProject(UUID id) {
        return ProjectResponse.from(findProjectOrThrow(id));
    }

    private static boolean hasTagFilter(List<String> tagNames) {
        return tagNames != null && !tagNames.isEmpty();
    }

    private static List<String> lowercased(List<String> tagNames) {
        return tagNames.stream().map(String::toLowerCase).toList();
    }

    private PageResponse<ProjectResponse> toPageResponse(Page<UUID> idPage) {
        Map<UUID, Project> byId = new HashMap<>();
        projectRepository.findAllById(idPage.getContent()).forEach(p -> byId.put(p.getId(), p));

        // byId.get(id) can miss if a project was deleted between the id query above and
        // findAllById -- filter rather than let ProjectResponse.from(null) NPE into a 500 for
        // what's a normal (if rare) concurrent-delete race, not an error condition.
        List<ProjectResponse> content = idPage.getContent().stream()
            .map(byId::get)
            .filter(Objects::nonNull)
            .map(ProjectResponse::from)
            .toList();

        return PageResponse.from(idPage, content);
    }

    @Transactional
    public ProjectResponse updateProject(UUID id, ProjectWriteRequest request) {
        Project project = findProjectOrThrow(id);
        project.setTitle(request.title());
        project.setDescription(request.description());
        project.setLinks(request.links().stream().map(l -> new Link(l.label(), l.url())).toList());
        project.setImages(request.images().toArray(new String[0]));
        project.setTags(resolveTags(request.tags()));
        // Unconditional assignment, including null: PUT is a full replacement, so omitting
        // startedOn/completedOn clears them rather than preserving what's stored. Skipping
        // the write when the incoming value is null would make it impossible to un-set a
        // date, and would silently diverge from the contract's stated semantics.
        project.setStartedOn(request.startedOn());
        project.setCompletedOn(request.completedOn());

        // NOT unconditional, unlike the two lines above, and the asymmetry is the point.
        // published and repoFullName are newer than the clients that PUT to this endpoint, so a
        // body that omits them is not asking for them to be cleared -- it predates them. Reading
        // that silence as "un-publish" would blank a live project on its next edit. See
        // ProjectWriteRequest.published.
        if (request.published() != null) {
            project.setPublished(request.published());
        }
        if (request.repoFullName() != null) {
            requireRepoFullNameUnclaimed(request.repoFullName(), id);
            project.setRepoFullName(request.repoFullName());
        }

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

    /**
     * Everything a verified GitHub webhook delivery is allowed to change, and the only entry
     * point into this module that {@code githubsync} calls.
     *
     * <p>Two rules from the Phase 7a ADR are enforced here, and neither by good behaviour:
     *
     * <ul>
     *   <li><b>No curated field is written.</b> The argument type cannot carry one
     *       ({@link GithubRepositoryMetadata} has four components), and the upsert's
     *       {@code DO UPDATE SET} list names only the three GitHub-authoritative columns. Two
     *       independent gates, because the failure is destroying prose the owner wrote.</li>
     *   <li><b>An unmatched repository becomes a draft, never a live entry.</b> The insert half
     *       writes {@code published = false} as a literal, so there is no path through this
     *       method that puts an automatically-created project on the public site.</li>
     * </ul>
     *
     * <p>The read either side of the upsert is only to report which of the two happened; nothing
     * branches on it, and the upsert -- not the read -- is what decides. See
     * {@link ProjectRepository#upsertFromGithub} for why that is an upsert rather than a
     * find-then-write.
     */
    @Transactional
    public ProjectSyncOutcome syncFromGithub(GithubRepositoryMetadata metadata) {
        boolean claimedAlready =
            projectRepository.findByRepoFullNameIgnoreCase(metadata.repoFullName()).isPresent();

        projectRepository.upsertFromGithub(
            UUID.randomUUID(),
            metadata.repoFullName(),
            metadata.shortName(),
            placeholderDescriptionFor(metadata.repoFullName()),
            metadata.lastPushedAt(),
            metadata.defaultBranch(),
            metadata.archived());

        Project project = projectRepository.findByRepoFullNameIgnoreCase(metadata.repoFullName())
            .orElseThrow(() -> new IllegalStateException(
                "upsertFromGithub should guarantee a project for " + metadata.repoFullName()));

        return new ProjectSyncOutcome(project.getId(), !claimedAlready);
    }

    private Project findProjectOrThrow(UUID id) {
        return projectRepository.findById(id)
            .orElseThrow(() -> new ResourceNotFoundException("Project not found: " + id));
    }

    /**
     * A repository may be claimed by at most one project, so that a delivery matches exactly
     * one. {@code ux_project_repo_full_name_lower} is the real guarantee; this exists to turn
     * the violation into a 409 the admin form can render instead of a constraint error.
     *
     * <p>Knowingly a check-then-act, in the sense of CLAUDE.md's checklist, and accepted rather
     * than missed: two concurrent writes claiming one repository would both pass this and one
     * would then fail on the index as a 500. There is a single admin account and these are
     * hand-driven form submissions, so the racing pair does not occur in this system's traffic
     * -- the same call {@code ContactService.submit} makes about its rate-limit count. The
     * sync path, where concurrency is real because GitHub supplies it, does not use this: it
     * goes through an atomic upsert.
     *
     * @param selfId the project being updated, exempt from colliding with itself, or null on
     *     create
     */
    private void requireRepoFullNameUnclaimed(String repoFullName, UUID selfId) {
        projectRepository.findByRepoFullNameIgnoreCase(repoFullName)
            .filter(other -> !other.getId().equals(selfId))
            .ifPresent(other -> {
                throw new DuplicateRepoFullNameException(
                    "Another project already tracks the repository " + repoFullName);
            });
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
