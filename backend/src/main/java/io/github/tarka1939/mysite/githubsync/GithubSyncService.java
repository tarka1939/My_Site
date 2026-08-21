package io.github.tarka1939.mysite.githubsync;

import java.nio.charset.StandardCharsets;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;

import io.github.tarka1939.mysite.MalformedWebhookPayloadException;

import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * Everything that happens to a webhook delivery after its signature checks out: parse it,
 * record it once, announce it. Nothing here trusts the payload -- {@link GithubWebhookController}
 * verifies before calling in, and that ordering is the point.
 */
public class GithubSyncService {

    private static final Logger log = LoggerFactory.getLogger(GithubSyncService.class);

    /** Matches {@code github_sync_record.repo_full_name}; GitHub's own maximum is about 140. */
    static final int MAX_REPO_FULL_NAME_LENGTH = 255;

    private final GithubSyncRecordRepository repository;
    private final ApplicationEventPublisher eventPublisher;
    private final ObjectMapper objectMapper;

    GithubSyncService(
        GithubSyncRecordRepository repository,
        ApplicationEventPublisher eventPublisher,
        ObjectMapper objectMapper
    ) {
        this.repository = repository;
        this.eventPublisher = eventPublisher;
        this.objectMapper = objectMapper;
    }

    /**
     * @param rawBody the verified bytes, still unparsed
     * @throws MalformedWebhookPayloadException if the verified body is not a JSON object, or
     *     names a repository whose name will not fit the column
     */
    public GithubWebhookAck accept(String deliveryId, String eventType, byte[] rawBody) {
        String repoFullName = extractRepoFullName(rawBody);
        UUID recordId = UUID.randomUUID();

        // Atomic: 1 means this delivery id was new, 0 means it was already recorded. No
        // "does it exist?" query precedes this -- see GithubSyncRecordRepository.insertIfAbsent
        // for why a pre-check would be a race rather than a safeguard. The repository method
        // carries its own @Transactional, so by the time it returns the row has committed and
        // the event below cannot announce something a rollback then erases.
        int inserted = repository.insertIfAbsent(
            recordId, deliveryId, eventType, repoFullName, new String(rawBody, StandardCharsets.UTF_8));

        if (inserted == 0) {
            log.info("GitHub delivery {} ({}) already recorded -- replay ignored, no event published",
                deliveryId, eventType);
            return new GithubWebhookAck(deliveryId, GithubWebhookAck.Status.DUPLICATE);
        }

        log.info("Recorded GitHub delivery {} ({}) for repo {}", deliveryId, eventType, repoFullName);
        // Inside the `inserted == 1` branch on purpose: exactly one event per accepted delivery,
        // not one per request. A replayed delivery reaches the branch above and returns before
        // this line.
        eventPublisher.publishEvent(
            new GithubDeliveryReceivedEvent(recordId, deliveryId, eventType, repoFullName));

        return new GithubWebhookAck(deliveryId, GithubWebhookAck.Status.RECORDED);
    }

    /**
     * Reads {@code repository.full_name}, tolerating its absence. An organization-level
     * {@code ping} has no {@code repository} object at all, and a delivery that names no repo
     * still has to be recorded -- otherwise idempotency has a hole exactly where the payload is
     * unusual. {@code stringValue(null)} rather than {@code asString(null)}: no coercion, so a
     * {@code full_name} that is a number or an object reads as absent instead of being
     * stringified into something that looks like a repo name.
     */
    private String extractRepoFullName(byte[] rawBody) {
        JsonNode root;
        try {
            root = objectMapper.readTree(rawBody);
        } catch (JacksonException e) {
            throw new MalformedWebhookPayloadException("Request body is not valid JSON");
        }
        if (!root.isObject()) {
            throw new MalformedWebhookPayloadException("Request body is not a JSON object");
        }

        String repoFullName = root.path("repository").path("full_name").stringValue(null);
        if (repoFullName != null && repoFullName.length() > MAX_REPO_FULL_NAME_LENGTH) {
            throw new MalformedWebhookPayloadException(
                "repository.full_name exceeds " + MAX_REPO_FULL_NAME_LENGTH + " characters");
        }
        return repoFullName;
    }
}
