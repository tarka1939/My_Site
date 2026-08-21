package io.github.tarka1939.mysite.project;

import java.time.Instant;
import java.util.Objects;

/**
 * What one GitHub repository looks like right now, in this module's vocabulary rather than
 * GitHub's.
 *
 * <p>This is the whole of the {@code githubsync} -> {@code project} boundary: the type crossing
 * it is a value object owned by the module being written to, and the calling module's job is to
 * adapt GitHub's JSON into it. No entity, no repository and no JPA type is exposed, so Spring
 * Modulith's {@code ApplicationModules.verify()} sees a dependency on this module's published
 * API and nothing else -- and, more usefully than that, a change to how {@code Project} is
 * stored cannot reach the webhook code.
 *
 * <p><b>These four fields are deliberately all there is.</b> The Phase 7a ADR permits sync to
 * write {@code lastPushedAt}, {@code defaultBranch} and {@code archived}, and nothing else: the
 * portfolio's prose is hand-written and signed off, so a repository description arriving on
 * {@code Project.description} would destroy content on somebody else's schedule. A field that is
 * not on this record cannot be passed, which is why the rule is expressed as a type rather than
 * as a comment on a wider one. Adding a curated field here is the change to refuse.
 *
 * @param repoFullName {@code owner/name}. Required -- it is what the project is matched on
 * @param lastPushedAt when the repository was last pushed to, or null if the delivery did not
 *     say. Null means "no statement", not "never": it leaves any stored value alone
 * @param defaultBranch the repository's default branch, or null for the same reason
 * @param archived whether GitHub has the repository archived, or null for the same reason.
 *     Boxed rather than primitive precisely so that "did not say" is expressible
 */
public record GithubRepositoryMetadata(
    String repoFullName,
    Instant lastPushedAt,
    String defaultBranch,
    Boolean archived
) {
    public GithubRepositoryMetadata {
        Objects.requireNonNull(repoFullName, "repoFullName");
        if (repoFullName.isBlank()) {
            throw new IllegalArgumentException("repoFullName must not be blank");
        }
    }

    /**
     * The short repository name -- {@code Equalizer} out of {@code tarka1939/Equalizer}. Used
     * only as the placeholder title of an auto-created draft; see
     * {@link ProjectService#syncFromGithub}.
     */
    String shortName() {
        int slash = repoFullName.lastIndexOf('/');
        return slash < 0 || slash == repoFullName.length() - 1
            ? repoFullName
            : repoFullName.substring(slash + 1);
    }
}
