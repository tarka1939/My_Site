package io.github.tarka1939.mysite.githubsync;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

/**
 * The ignore mechanism, tested at the only place its polarity is visible: what it does when
 * nobody has configured it.
 */
class GithubSyncPolicyTest {

    /**
     * The whole argument for an allowlist in one assertion. An unconfigured denylist would
     * answer true here -- and "unconfigured" is the state of a fresh environment, a deploy where
     * the variable was missed, and a copied config, all of which would then turn every
     * repository the owner pushes to into a row in the CMS.
     */
    @Test
    void withNothingConfigured_nothingIsSynced() {
        GithubSyncPolicy policy = new GithubSyncPolicy("");

        assertThat(policy.isSynced("tarka1939/My_Site")).isFalse();
        assertThat(policy.isSynced("anyone/anything")).isFalse();
        assertThat(policy.syncedRepositories()).isEmpty();
    }

    @Test
    void withNoPropertyAtAll_nothingIsSynced() {
        assertThat(new GithubSyncPolicy(null).isSynced("tarka1939/My_Site")).isFalse();
    }

    @Test
    void onlyListedRepositoriesAreSynced() {
        GithubSyncPolicy policy = new GithubSyncPolicy("tarka1939/Equalizer, tarka1939/My_Site");

        assertThat(policy.isSynced("tarka1939/Equalizer")).isTrue();
        assertThat(policy.isSynced("tarka1939/My_Site")).isTrue();
        assertThat(policy.isSynced("tarka1939/private-experiment")).isFalse();
    }

    /**
     * GitHub is not consistent about the case it reports a repository's full name in, and the
     * owner types their own username however they type it. A case-sensitive allowlist would
     * silently stop syncing a repository the owner believes is listed.
     */
    @Test
    void matchingIsCaseInsensitive() {
        GithubSyncPolicy policy = new GithubSyncPolicy("Tarka1939/Equalizer");

        assertThat(policy.isSynced("tarka1939/equalizer")).isTrue();
        assertThat(policy.isSynced("TARKA1939/EQUALIZER")).isTrue();
    }

    /**
     * A delivery that named no repository -- an organisation-level ping, say. It is recorded in
     * the ledger, and it syncs nothing.
     */
    @Test
    void aNullRepositoryIsNeverSynced() {
        assertThat(new GithubSyncPolicy("tarka1939/Equalizer").isSynced(null)).isFalse();
    }

    @Test
    void trailingAndDoubledCommasAreTolerated() {
        GithubSyncPolicy policy = new GithubSyncPolicy("tarka1939/Equalizer,, ,");

        assertThat(policy.syncedRepositories()).containsExactly("tarka1939/equalizer");
    }

    /**
     * Present-but-malformed fails at bean creation, which is CLAUDE.md's config rule and not
     * pedantry: an entry that cannot match any delivery would mean "this repository is never
     * synced" for a repository the owner has just written down as one that is. The failure names
     * the offending entry.
     */
    @Test
    void anEntryThatIsNotOwnerSlashName_refusesToStart() {
        new ApplicationContextRunner()
            .withUserConfiguration(GithubSyncPolicy.class)
            .withPropertyValues(
                "app.github-sync.enabled=true",
                "app.github-sync.synced-repositories=tarka1939/Equalizer,just-a-name")
            .run(context -> assertThat(context)
                .hasFailed()
                .getFailure()
                .rootCause()
                .hasMessageContaining("just-a-name"));
    }

    @Test
    void anEntryWithTooManySegments_refusesToStart() {
        new ApplicationContextRunner()
            .withUserConfiguration(GithubSyncPolicy.class)
            .withPropertyValues(
                "app.github-sync.enabled=true",
                "app.github-sync.synced-repositories=github.com/tarka1939/Equalizer")
            .run(context -> assertThat(context).hasFailed());
    }

    /**
     * The counterpart: absent is not malformed. An empty allowlist is a designed no-op, so the
     * bean exists and answers false, rather than the application refusing to boot.
     */
    @Test
    void anEmptyAllowlistStartsCleanly() {
        new ApplicationContextRunner()
            .withUserConfiguration(GithubSyncPolicy.class)
            .withPropertyValues("app.github-sync.enabled=true")
            .run(context -> {
                assertThat(context).hasNotFailed();
                assertThat(context.getBean(GithubSyncPolicy.class).isSynced("tarka1939/x")).isFalse();
            });
    }
}
