package io.github.tarka1939.mysite.project;

import java.util.UUID;

/**
 * What a {@link ProjectService#syncFromGithub} call did, for the caller to log.
 *
 * <p>Not a DTO at any controller boundary -- no endpoint returns this. It exists so that the
 * webhook listener can say "created a draft" or "updated an existing project" in a log line
 * without reaching for an entity to inspect.
 *
 * @param projectId the project that now claims the repository
 * @param created true if this delivery brought the project into existence as an unpublished
 *     draft, false if it updated one that was already there. Best-effort under concurrency: two
 *     simultaneous deliveries for a repository nobody claimed yet can both report created, since
 *     the distinction is read outside the upsert rather than decided by it. It is a log label,
 *     and nothing branches on it
 */
public record ProjectSyncOutcome(UUID projectId, boolean created) {
}
