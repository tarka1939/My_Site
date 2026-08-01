package io.github.tarka1939.mysite.project;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

/**
 * No-op reference listener for {@link ProjectCreatedEvent} — proves the publish/subscribe
 * pattern works before any Phase 7 extension needs to hook into it for real.
 */
@Component
public class ProjectCreatedEventListener {

    private static final Logger log = LoggerFactory.getLogger(ProjectCreatedEventListener.class);

    @EventListener
    public void onProjectCreated(ProjectCreatedEvent event) {
        log.info("Project created: {}", event.projectId());
    }
}
