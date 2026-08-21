package io.github.tarka1939.mysite.githubsync;

import java.time.Instant;
import java.time.format.DateTimeParseException;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import io.github.tarka1939.mysite.project.GithubRepositoryMetadata;

import tools.jackson.databind.JsonNode;

/**
 * Reads GitHub's {@code repository} object into this application's vocabulary.
 *
 * <p>This is the whole of the anti-corruption layer between GitHub's payload shapes and the
 * {@code project} module: GitHub's field names, types and quirks stop here, and what crosses the
 * module boundary is a {@link GithubRepositoryMetadata}. That type has four components, three of
 * which sync is permitted to write, so no amount of extra data in a payload can widen what a
 * delivery changes.
 *
 * <p>Reads three fields and no more, deliberately. {@code repository.description} is right there
 * and is the one field this must never pass on -- the portfolio's prose is hand-written and
 * signed off, and a repository description arriving on {@code Project.description} would destroy
 * it on every push.
 */
final class GithubRepositoryPayload {

    private static final Logger log = LoggerFactory.getLogger(GithubRepositoryPayload.class);

    private GithubRepositoryPayload() {
    }

    /**
     * @param root the parsed delivery body
     * @param repoFullName the name already extracted and recorded by {@link GithubSyncService},
     *     used rather than re-reading it so that what is synced and what is in the ledger cannot
     *     disagree
     */
    static GithubRepositoryMetadata read(JsonNode root, String repoFullName) {
        JsonNode repository = root.path("repository");
        return new GithubRepositoryMetadata(
            repoFullName,
            readPushedAt(repository.path("pushed_at")),
            repository.path("default_branch").stringValue(null),
            readArchived(repository.path("archived")));
    }

    /**
     * {@code pushed_at} has two representations in GitHub's own payloads and both turn up here:
     * a {@code push} event carries Unix epoch <i>seconds as a number</i>, while the REST
     * representation embedded in most other events carries an ISO-8601 string. Handling only one
     * of them would work in whichever test was written first and drop the field silently in
     * production for the other -- and, worse, the number form is the one on the event this
     * feature is named after.
     *
     * <p>Anything else -- absent, null, a boolean, an unparseable string -- reads as "the
     * delivery said nothing", which leaves whatever is stored alone rather than erasing it.
     */
    private static Instant readPushedAt(JsonNode pushedAt) {
        if (pushedAt.isNumber()) {
            return Instant.ofEpochSecond(pushedAt.longValue());
        }
        String text = pushedAt.stringValue(null);
        if (text == null || text.isBlank()) {
            return null;
        }
        try {
            return Instant.parse(text);
        } catch (DateTimeParseException e) {
            // Not a failure worth rejecting the delivery over: the other two fields are still
            // usable, and refusing the whole sync because one timestamp was unrecognisable would
            // lose more than it protects. Logged so it is not invisible.
            log.warn("Ignoring unparseable repository.pushed_at value; syncing the rest of the delivery");
            return null;
        }
    }

    /**
     * Boxed, so that "the payload did not mention it" stays distinguishable from "GitHub says
     * false". {@code booleanValue()} would collapse the two, and the collapse is not free: it
     * would un-archive a project on any delivery whose payload happened to omit the field.
     */
    private static Boolean readArchived(JsonNode archived) {
        return archived.isBoolean() ? archived.booleanValue() : null;
    }
}
