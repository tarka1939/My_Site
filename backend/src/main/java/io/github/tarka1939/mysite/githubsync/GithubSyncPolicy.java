package io.github.tarka1939.mysite.githubsync;

import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Set;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Which repositories a verified delivery is allowed to write a Project for.
 *
 * <p><b>An allowlist, not a denylist, and the empty case is why.</b> The Phase 7a ADR requires
 * an ignore mechanism because a webhook installed at organisation scope makes every repository
 * the owner touches into a draft -- private ones, experiments, forks -- and deleting the draft
 * does not help, since the next push recreates it. It describes that mechanism as a denylist.
 * This is the same mechanism with the polarity reversed, for three reasons:
 *
 * <ul>
 *   <li><b>Empty fails closed.</b> An empty allowlist syncs nothing; an empty denylist syncs
 *       everything. Those are the two possible states of a configuration nobody has filled in
 *       yet -- a fresh environment, a deploy where the variable was forgotten, a copied config
 *       -- and one of them quietly turns the owner's private repositories into rows in the CMS.
 *       CLAUDE.md's standing instruction is to deny by default and permit only under an
 *       explicitly named allow case, never the reverse.</li>
 *   <li><b>The sets are different sizes.</b> A portfolio tracks a handful of repositories and
 *       the owner knows which. The repositories that should <i>not</i> appear are unbounded and
 *       grow every time a new one is created -- so a denylist is a list you have to remember to
 *       extend, and the cost of forgetting is public.</li>
 *   <li><b>It gives "on but not yet trusted" a spelling.</b> Enabled with an empty allowlist,
 *       the receiver verifies and records deliveries and writes nothing, which is a genuinely
 *       useful state to deploy into while confirming the webhook is wired up correctly.</li>
 * </ul>
 *
 * <p>This deviates from the ADR's wording, not its intent -- what it asks for is an ignore
 * mechanism, and its stated worry is a CMS filling with noise. Both polarities answer that; only
 * one of them answers it when the config is blank.
 *
 * <p><b>No wildcards.</b> Entries are exact {@code owner/name} values. Supporting
 * {@code owner/*} would put the fail-open case straight back: one entry that means "the whole
 * account", written once and never revisited.
 *
 * <p><b>Absent is fine, malformed is fatal.</b> No property at all means an empty allowlist,
 * which is a designed no-op, exactly as {@code RESEND_API_KEY}'s absence is. An entry that is
 * present but cannot be a repository name is a different thing: it can never match anything, so
 * it would silently mean "this repository is not synced" for a repository the owner believes is.
 * That fails at startup, naming the entry. CLAUDE.md's config-validation rule is precisely this
 * distinction -- degrade on absent-optional, fail fast on present-but-wrong.
 */
@Component
@ConditionalOnGithubSyncEnabled
public class GithubSyncPolicy {

    /** GitHub's whole format for a full name: two non-empty, slash-free segments. */
    private static final String REPO_FULL_NAME_PATTERN = "[^\\s/]+/[^\\s/]+";

    private final Set<String> syncedRepositories;

    GithubSyncPolicy(@Value("${app.github-sync.synced-repositories:}") String syncedRepositories) {
        this.syncedRepositories = parse(syncedRepositories);
    }

    private static Set<String> parse(String raw) {
        if (raw == null || raw.isBlank()) {
            return Set.of();
        }
        Set<String> parsed = new LinkedHashSet<>();
        for (String entry : Arrays.stream(raw.split(",")).map(String::trim).toList()) {
            if (entry.isEmpty()) {
                // A trailing comma or a doubled one. Harmless and easy to type, so tolerated
                // rather than fatal -- it says nothing wrong, it just says nothing.
                continue;
            }
            if (!entry.matches(REPO_FULL_NAME_PATTERN)) {
                throw new IllegalStateException(
                    "app.github-sync.synced-repositories (GITHUB_SYNC_REPOSITORIES) entry '" + entry
                        + "' is not a GitHub repository as owner/name. An entry that cannot match"
                        + " a delivery would silently mean that repository is never synced.");
            }
            // Stored lower-cased and compared lower-cased, matching
            // ux_project_repo_full_name_lower and GitHub's own case-insensitivity about
            // repository names. The alternative is an allowlist that silently misses because the
            // owner typed their username with a different capital than GitHub reports.
            parsed.add(entry.toLowerCase(Locale.ROOT));
        }
        return Set.copyOf(parsed);
    }

    /**
     * @param repoFullName {@code owner/name} from a verified delivery, or null if it named no
     *     repository
     * @return true only for a repository explicitly listed. Null, blank, and anything unlisted
     *     are all false
     */
    public boolean isSynced(String repoFullName) {
        return repoFullName != null
            && syncedRepositories.contains(repoFullName.toLowerCase(Locale.ROOT));
    }

    /** For logging the configured state at startup; not part of any decision. */
    public Set<String> syncedRepositories() {
        return syncedRepositories;
    }
}
