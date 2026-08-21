package io.github.tarka1939.mysite.githubsync;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

import io.github.tarka1939.mysite.project.ProjectService;

import tools.jackson.databind.ObjectMapper;

/**
 * The two gates that make an unverified payload impossible, tested as configuration rather
 * than through HTTP.
 *
 * <p>PROJECT_TODO.md's Definition of Done asks that absence of configuration be its own test
 * case -- not just the branches somebody remembered to write config for. So the first test here
 * sets no properties at all, which is the state a fresh deployment that has never heard of this
 * feature is in.
 */
class GithubSyncEnablementTest {

    /**
     * Registers every {@link ConditionalOnGithubSyncEnabled} class directly, so the condition is
     * evaluated exactly as component scanning would evaluate it, without the cost of a full
     * application context per property permutation.
     *
     * <p>#54 added two of these -- the sync policy and the sync listener -- and adding them here
     * is the point of the list being explicit: a class that quietly missed the annotation would
     * exist while the feature is switched off, and for the listener that means a bean that writes
     * to the Project table on an event the flag was supposed to prevent ever being published.
     */
    private final ApplicationContextRunner contextRunner = new ApplicationContextRunner()
        .withUserConfiguration(
            GithubSignatureVerifier.class, GithubSyncService.class, GithubWebhookController.class,
            GithubSyncPolicy.class, GithubProjectSyncListener.class)
        .withBean(GithubSyncRecordRepository.class, () -> mock(GithubSyncRecordRepository.class))
        .withBean(ProjectService.class, () -> mock(ProjectService.class))
        .withBean(ObjectMapper.class, ObjectMapper::new);

    @Test
    void withNoConfigurationAtAll_thereIsNoReceiver() {
        contextRunner.run(context -> {
            assertThat(context).hasNotFailed();
            assertThat(context).doesNotHaveBean(GithubWebhookController.class);
            assertThat(context).doesNotHaveBean(GithubSyncService.class);
            assertThat(context).doesNotHaveBean(GithubSignatureVerifier.class);
            // The two #54 added. The listener especially: with the flag off there must be no
            // bean subscribed to a delivery event, so there is no code path to a Project write
            // rather than a path guarded by a check.
            assertThat(context).doesNotHaveBean(GithubSyncPolicy.class);
            assertThat(context).doesNotHaveBean(GithubProjectSyncListener.class);
        });
    }

    @Test
    void explicitlyDisabled_thereIsNoReceiver() {
        contextRunner
            .withPropertyValues("app.github-sync.enabled=false")
            .run(context -> {
                assertThat(context).hasNotFailed();
                assertThat(context).doesNotHaveBean(GithubWebhookController.class);
            });
    }

    /**
     * A non-boolean value must not read as "on". {@code @ConditionalOnProperty}'s
     * {@code havingValue="true"} is an equality check, not a truthiness one, which is the
     * behaviour wanted here -- but it is worth pinning, since the whole design leans on the
     * flag having exactly one way to be enabled.
     */
    @Test
    void aGarbageFlagValue_isNotOn() {
        contextRunner
            .withPropertyValues("app.github-sync.enabled=yes")
            .run(context -> assertThat(context).doesNotHaveBean(GithubWebhookController.class));
    }

    /**
     * The case the whole fail-closed argument is about: someone turns the receiver on and
     * forgets the secret. Booting would mean serving a public endpoint that cannot verify
     * anything. Refusing to boot is loud, immediate, and names the property.
     *
     * <p>Note what this and the two below assert, and what they cannot: a context that failed
     * to start cannot then be asked whether it has a bean -- AssertJ's context assertions
     * reject that, which cost a first draft of this test. "Refused to start" is the whole
     * claim, and it is also the whole point: a receiver that never got a context has no
     * endpoint to serve.
     */
    @Test
    void enabledWithNoSecret_refusesToStart() {
        contextRunner
            .withPropertyValues("app.github-sync.enabled=true")
            .run(context -> {
                assertThat(context).hasFailed();
                assertThat(context.getStartupFailure())
                    .hasRootCauseInstanceOf(IllegalStateException.class);
                assertThat(context.getStartupFailure())
                    .rootCause()
                    .hasMessageContaining("app.github-sync.webhook-secret");
            });
    }

    @Test
    void enabledWithABlankSecret_refusesToStart() {
        contextRunner
            .withPropertyValues("app.github-sync.enabled=true", "app.github-sync.webhook-secret=   ")
            .run(context -> assertThat(context).hasFailed());
    }

    @Test
    void enabledWithATooShortSecret_refusesToStart() {
        contextRunner
            .withPropertyValues(
                "app.github-sync.enabled=true",
                "app.github-sync.webhook-secret=short")
            .run(context -> {
                assertThat(context).hasFailed();
                assertThat(context.getStartupFailure())
                    .rootCause()
                    .hasMessageContaining(String.valueOf(GithubSignatureVerifier.MIN_SECRET_LENGTH));
            });
    }

    @Test
    void enabledWithAProperSecret_wiresTheReceiver() {
        contextRunner
            .withPropertyValues(
                "app.github-sync.enabled=true",
                "app.github-sync.webhook-secret=a-sufficiently-long-test-webhook-secret")
            .run(context -> {
                assertThat(context).hasNotFailed();
                assertThat(context).hasSingleBean(GithubWebhookController.class);
                assertThat(context).hasSingleBean(GithubSyncService.class);
                assertThat(context).hasSingleBean(GithubSignatureVerifier.class);
                assertThat(context).hasSingleBean(GithubSyncPolicy.class);
                assertThat(context).hasSingleBean(GithubProjectSyncListener.class);
            });
    }
}
