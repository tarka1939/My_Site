package io.github.tarka1939.mysite.project;

import java.util.UUID;

/**
 * Published when a new project is created. Reference example for how Phase 7 extensions
 * (analytics, GitHub sync) can react to core CMS actions via {@code ApplicationEventPublisher}
 * without being directly coupled to the project module.
 */
public record ProjectCreatedEvent(UUID projectId) {
}
