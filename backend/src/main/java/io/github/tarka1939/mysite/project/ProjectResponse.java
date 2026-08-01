package io.github.tarka1939.mysite.project;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record ProjectResponse(
    UUID id,
    String title,
    String description,
    List<Link> links,
    List<String> images,
    List<TagResponse> tags,
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
            project.getCreatedAt(),
            project.getUpdatedAt()
        );
    }
}
