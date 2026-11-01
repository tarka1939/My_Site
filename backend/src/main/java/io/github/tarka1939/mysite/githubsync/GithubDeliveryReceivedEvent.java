package io.github.tarka1939.mysite.githubsync;

import java.util.UUID;

/**
 * Published once per <i>accepted</i> delivery: signature verified, and newly recorded rather
 * than a replay. A redelivery of an id already in the ledger publishes nothing.
 *
 * <p><b>This is the seam.</b> #53 stopped here: it verified, recorded and announced, and nothing
 * listened, because what a verified delivery should change was still an open decision. This
 * portfolio's project prose is hand-curated (#49, {@code content-seed/projects.json}), so a
 * handler that copied a repository's GitHub description over {@code Project.description} would
 * destroy written content. #54 then added the subscriber, {@link GithubProjectSyncListener},
 * which writes only the fields GitHub is authoritative for and never a curated one
 * ({@code docs/DECISIONS.md}, 2026-08-18). {@code docs/DECISIONS.md} names
 * {@code ApplicationEventPublisher} as how features talk to each other here, and routing
 * through it is what keeps the ledger code from depending on what consumes it.
 *
 * <p>Carries the record id rather than the payload, so a listener reads what it needs from the
 * ledger, as {@link GithubProjectSyncListener} does, instead of this record growing a field per
 * consumer. Note it is a <i>mutable-state-free</i> summary on purpose: no {@code byte[]}, which
 * would need defensive copying to be safe to hand around.
 *
 * <p>Known limitation: the insert commits before this is published, so a crash in between
 * records a delivery that is never processed -- and the redelivery would be dropped as a
 * duplicate. That is at-most-once. Since #54 it costs a project update, or the draft a new
 * repository would have become, and either stays bounded to staleness until the repository's
 * next push; {@link GithubProjectSyncListener} explains why, and why the durable fix,
 * {@code spring-modulith-events}, is still an undecided ADR rather than code here.
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
