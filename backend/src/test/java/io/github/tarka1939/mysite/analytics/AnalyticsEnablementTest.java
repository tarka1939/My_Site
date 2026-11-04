package io.github.tarka1939.mysite.analytics;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.config.BeanDefinition;
import org.springframework.boot.test.context.assertj.AssertableApplicationContext;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.ClassPathScanningCandidateComponentProvider;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.mock.env.MockEnvironment;

import io.github.tarka1939.mysite.ClientIpResolver;
import io.github.tarka1939.mysite.InMemoryRateLimiter;
import io.github.tarka1939.mysite.project.ProjectService;

/**
 * The flag, tested as configuration, on {@code GithubSyncEnablementTest}'s pattern: every
 * {@link ConditionalOnAnalyticsEnabled} class registered directly, so the condition is evaluated as
 * component scanning would evaluate it, with no application context per permutation. The HTTP
 * consequence, three 404s, is {@code AnalyticsDisabledIntegrationTest}'s.
 */
class AnalyticsEnablementTest {

    private static final List<Class<?>> GATED = List.of(
        DailyVisitorHasher.class, AnalyticsEventStore.class, AnalyticsService.class,
        AnalyticsController.class, AnalyticsSummaryService.class, AdminAnalyticsController.class);

    private final ApplicationContextRunner contextRunner = new ApplicationContextRunner()
        .withUserConfiguration(GATED.toArray(Class<?>[]::new))
        .withBean(JdbcClient.class, () -> mock(JdbcClient.class))
        .withBean(ProjectService.class, () -> mock(ProjectService.class))
        .withBean(ClientIpResolver.class, () -> mock(ClientIpResolver.class))
        .withBean(InMemoryRateLimiter.class, () -> mock(InMemoryRateLimiter.class));

    /** A fresh deployment that has never heard of the feature. */
    @Test
    void withNoConfigurationAtAll_noAnalyticsBeanExists() {
        contextRunner.run(AnalyticsEnablementTest::assertNoneExist);
    }

    @Test
    void explicitlyDisabled_noAnalyticsBeanExists() {
        contextRunner.withPropertyValues("app.analytics.enabled=false").run(AnalyticsEnablementTest::assertNoneExist);
    }

    /** {@code havingValue = "true"} is not a truthiness test, so a value that sounds on is off. */
    @Test
    void aGarbageFlagValue_isNotOn() {
        contextRunner.withPropertyValues("app.analytics.enabled=yes").run(AnalyticsEnablementTest::assertNoneExist);
    }

    /** {@code havingValue} is compared ignoring case, so {@code true} in any case turns it on. */
    @Test
    void anUpperCaseTrue_isOn() {
        contextRunner.withPropertyValues("app.analytics.enabled=TRUE")
            .run(AnalyticsEnablementTest::assertAllExist);
    }

    @Test
    void enabled_wiresEveryAnalyticsBean() {
        contextRunner.withPropertyValues("app.analytics.enabled=true")
            .run(AnalyticsEnablementTest::assertAllExist);
    }

    /**
     * The list above is only as good as its completeness. Every component the package declares
     * must be on it and carry the annotation, so a bean added later without the flag fails here
     * rather than quietly existing while analytics is off.
     */
    @Test
    void everyComponentInThePackageIsGatedAndListed() {
        // The scanner evaluates @Conditional itself, so it is given the flag on: what it finds is
        // then every component that exists while analytics is enabled.
        ClassPathScanningCandidateComponentProvider scanner = new ClassPathScanningCandidateComponentProvider(
            true, new MockEnvironment().withProperty("app.analytics.enabled", "true"));
        Set<String> components = scanner.findCandidateComponents(AnalyticsEnablementTest.class.getPackageName())
            .stream()
            .map(BeanDefinition::getBeanClassName)
            .collect(Collectors.toSet());

        assertThat(components)
            .containsExactlyInAnyOrderElementsOf(GATED.stream().map(Class::getName).toList());
        for (Class<?> gated : GATED) {
            assertThat(gated.isAnnotationPresent(ConditionalOnAnalyticsEnabled.class)).as(gated.getName()).isTrue();
        }
    }

    private static void assertAllExist(AssertableApplicationContext context) {
        assertThat(context).hasNotFailed();
        for (Class<?> gated : GATED) {
            assertThat(context).hasSingleBean(gated);
        }
    }

    private static void assertNoneExist(AssertableApplicationContext context) {
        assertThat(context).hasNotFailed();
        for (Class<?> gated : GATED) {
            assertThat(context).doesNotHaveBean(gated);
        }
    }
}
