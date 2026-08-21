package io.github.tarka1939.mysite.githubsync;

import java.util.Set;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

import io.github.tarka1939.mysite.project.GithubRepositoryMetadata;
import io.github.tarka1939.mysite.project.ProjectService;
import io.github.tarka1939.mysite.project.ProjectSyncOutcome;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * The subscriber #53 left a seam for: turns an accepted delivery into a Project update.
 *
 * <p><b>Where this lives, and why here.</b> It is in {@code githubsync}, not {@code project}, and
 * it calls {@code project}'s published API rather than {@code project} listening to this module's
 * event. Both directions satisfy Spring Modulith -- {@code ApplicationModules.verify()} objects
 * to reaching into another module's internals, not to depending on its API -- so the choice is
 * about which dependency is the right way round. {@code project} is the core CMS and
 * {@code githubsync} is an optional, feature-flagged extension: a listener living in
 * {@code project} would make the core import a type from an extension, and deleting the
 * extension would stop the core compiling. This way the arrow points extension -> core, and
 * {@code project} does not know that GitHub sync exists.
 *
 * <p>What crosses the boundary is {@link GithubRepositoryMetadata}, a four-component value type
 * that {@code project} owns and this module fills in. No entity, no repository and no JPA type
 * crosses; GitHub's payload shapes stop at {@link GithubRepositoryPayload}.
 *
 * <p><b>Delivery guarantee, restated because it now matters.</b> #53 published this event after
 * the ledger insert had already committed, which makes delivery at-most-once: a crash between
 * the commit and the publish records a delivery nothing ever processes, and GitHub's redelivery
 * of it is dropped as a duplicate. That was harmless while nothing consumed the event. It is no
 * longer harmless -- the lost work is now a project update -- but it is still bounded, because
 * every field sync writes is a current-state fact rather than an increment: {@code pushed_at},
 * {@code default_branch} and {@code archived} are each overwritten wholesale by the next
 * delivery for that repository. A dropped delivery therefore costs staleness until the next
 * push, not a wrong value, and it cannot corrupt anything. The durable fix is
 * {@code spring-modulith-events}' publication registry, which docs/DECISIONS.md already lists as
 * undecided; it wants its own ADR (a dependency, a schema, a republish-on-restart story) rather
 * than being added quietly here.
 */
@Component
@ConditionalOnGithubSyncEnabled
class GithubProjectSyncListener {

    private static final Logger log = LoggerFactory.getLogger(GithubProjectSyncListener.class);

    /**
     * "On push/release events", from #54's title. Both carry a full {@code repository} object, so
     * both can update the GitHub-authoritative fields. Everything else -- {@code ping},
     * {@code issues}, {@code star}, whatever a future webhook configuration adds -- is recorded
     * in the ledger and changes no project. An allowlist here for the same reason as
     * {@link GithubSyncPolicy}: a new event type nobody has considered should do nothing, not
     * something.
     */
    static final Set<String> SYNCING_EVENT_TYPES = Set.of("push", "release");

    private final GithubSyncRecordRepository repository;
    private final GithubSyncPolicy syncPolicy;
    private final ProjectService projectService;
    private final ObjectMapper objectMapper;

    GithubProjectSyncListener(
        GithubSyncRecordRepository repository,
        GithubSyncPolicy syncPolicy,
        ProjectService projectService,
        ObjectMapper objectMapper
    ) {
        this.repository = repository;
        this.syncPolicy = syncPolicy;
        this.projectService = projectService;
        this.objectMapper = objectMapper;
    }

    /**
     * Synchronous, on the request thread, and swallowing its own failures.
     *
     * <p>Synchronous rather than {@code @Async} because the work is one short transaction and
     * because an async hop makes every test of it a timing test -- #53's concurrency test already
     * demonstrated how easily a harness measures itself rather than the code.
     *
     * <p>Swallowing rather than propagating because of what a propagated exception would buy: the
     * ledger row has already committed by the time this runs, so a 500 back to GitHub triggers a
     * redelivery that {@code insertIfAbsent} will reject as a duplicate. That is a retry which
     * cannot succeed, presented to the owner as if it might. A 2xx here is also the honest
     * answer to the question the endpoint actually answers -- "have you got this delivery?" --
     * and it has. The failure is logged at ERROR with the delivery id, and the payload is in the
     * ledger, so a lost sync is attributable and replayable by hand.
     */
    @EventListener
    void onDeliveryReceived(GithubDeliveryReceivedEvent event) {
        try {
            sync(event);
        } catch (RuntimeException e) {
            log.error("GitHub delivery {} ({}) was recorded but its project sync failed;"
                + " the payload is in github_sync_record {} for a manual replay",
                event.deliveryId(), event.eventType(), event.recordId(), e);
        }
    }

    private void sync(GithubDeliveryReceivedEvent event) {
        if (!SYNCING_EVENT_TYPES.contains(event.eventType())) {
            log.debug("GitHub delivery {} is a {} -- recorded, no project sync",
                event.deliveryId(), event.eventType());
            return;
        }
        // Null when the delivery named no repository. isSynced answers false for it, but the
        // check is spelled out because "unnamed" and "not on the allowlist" are different facts
        // and the log line should say which happened.
        if (event.repoFullName() == null) {
            log.debug("GitHub delivery {} named no repository -- recorded, no project sync",
                event.deliveryId());
            return;
        }
        if (!syncPolicy.isSynced(event.repoFullName())) {
            log.info("GitHub delivery {} is for {}, which is not on app.github-sync"
                + ".synced-repositories -- recorded, no project created or updated",
                event.deliveryId(), event.repoFullName());
            return;
        }

        GithubSyncRecord record = repository.findById(event.recordId()).orElse(null);
        if (record == null || record.getRawPayload() == null) {
            // The event carries the record id rather than the payload (see the event's own note),
            // so this is the only place the body can come from. A missing row means something
            // deleted it between commit and now; there is nothing to sync from and nothing to fix
            // here.
            log.warn("GitHub delivery {} has no stored payload to sync from", event.deliveryId());
            return;
        }

        JsonNode root = objectMapper.readTree(record.getRawPayload());
        GithubRepositoryMetadata metadata =
            GithubRepositoryPayload.read(root, event.repoFullName());

        ProjectSyncOutcome outcome = projectService.syncFromGithub(metadata);

        if (outcome.created()) {
            log.info("GitHub delivery {} created project {} as an unpublished draft for {}",
                event.deliveryId(), outcome.projectId(), event.repoFullName());
        } else {
            log.info("GitHub delivery {} updated project {}'s GitHub fields for {}",
                event.deliveryId(), outcome.projectId(), event.repoFullName());
        }
    }
}
