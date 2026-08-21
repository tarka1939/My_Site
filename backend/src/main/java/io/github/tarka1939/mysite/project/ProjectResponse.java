package io.github.tarka1939.mysite.project;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * Matches docs/openapi.yaml's Project schema, field order included.
 *
 * <p>{@code startedOn} null means unspecified; {@code completedOn} null means the project is
 * ongoing. Both are dates describing the work, distinct from {@code createdAt}/{@code updatedAt},
 * which record when the row was written.
 */
public record ProjectResponse(
    UUID id,
    String title,
    String description,
    List<Link> links,
    List<String> images,
    List<TagResponse> tags,
    LocalDate startedOn,
    LocalDate completedOn,
    boolean published,
    String repoFullName,
    Instant lastPushedAt,
    String defaultBranch,
    boolean archived,
    Instant createdAt,
    Instant updatedAt
) {
    static ProjectResponse from(Project project) {
        return new ProjectResponse(
            project.getId(),
            project.getTitle(),
            project.getDescription(),
            project.getLinks(),
            List.of(project.getImages()),
            project.getTags().stream().map(TagResponse::from).toList(),
            project.getStartedOn(),
            project.getCompletedOn(),
            // Always true in anything the public endpoints return -- they cannot return anything
            // else. Serialised regardless, because GET /admin/projects is where it carries
            // information: the admin list has to be able to mark a draft as one.
            project.isPublished(),
            project.getRepoFullName(),
            project.getLastPushedAt(),
            project.getDefaultBranch(),
            project.isArchived(),
            project.getCreatedAt(),
            project.getUpdatedAt()
        );
    }
}
