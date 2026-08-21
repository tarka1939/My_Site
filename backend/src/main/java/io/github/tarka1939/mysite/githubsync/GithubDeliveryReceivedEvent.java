package io.github.tarka1939.mysite.githubsync;

import java.util.UUID;

/**
 * Published once per <i>accepted</i> delivery: signature verified, and newly recorded rather
 * than a replay. A redelivery of an id already in the ledger publishes nothing.
 *
 * <p><b>This is the seam.</b> Phase 7a deliberately stops here -- it verifies, records and
 * announces, and nothing listens. What a verified delivery should actually change is issue #54
 * and an open decision with the owner: this portfolio's project prose is hand-curated (#49,
 * {@code content-seed/projects.json}), so a handler that copied a repository's GitHub
 * description over {@code Project.description} would destroy written content. Publishing an
 * event with no subscriber is the intended end state of this phase, not a placeholder --
 * {@code docs/DECISIONS.md} names {@code ApplicationEventPublisher} as how features talk to
 * each other here, and routing through it is what keeps {@code githubsync} from importing
 * anything out of {@code project} (Spring Modulith's {@code ApplicationModules.verify()} would
 * fail the build if it did).
 *
 * <p>Carries the record id rather than the payload, so a future listener reads what it needs
 * from the ledger instead of this record growing a field per consumer. Note it is a
 * <i>mutable-state-free</i> summary on purpose: no {@code byte[]}, which would need defensive
 * copying to be safe to hand around.
 *
 * <p>Known limitation, to be settled by #54 rather than here: the insert commits before this is
 * published, so a crash in between records a delivery that is never processed -- and the
 * redelivery would be dropped as a duplicate. That is at-most-once. {@code docs/DECISIONS.md}
 * already flags {@code spring-modulith-events} (durable, transactional event publication) as
 * the answer if this matters, and marks it as not yet decided. It does not matter yet, because
 * nothing consumes this.
 *
 * @param recordId the {@code GithubSyncRecord} just written
 * @param deliveryId GitHub's {@code X-GitHub-Delivery} value
 * @param eventType GitHub's {@code X-GitHub-Event} value -- {@code push}, {@code release}, ...
 * @param repoFullName {@code owner/name}, or null if the delivery named no repository
 */
public record GithubDeliveryReceivedEvent(
    UUID recordId,
    String deliveryId,
    String eventType,
    String repoFullName
) {
}
