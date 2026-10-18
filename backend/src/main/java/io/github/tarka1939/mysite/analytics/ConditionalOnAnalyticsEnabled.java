package io.github.tarka1939.mysite.analytics;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;

/**
 * The Phase 7c feature flag, defined once and applied by name, on 7a's pattern
 * ({@code ConditionalOnGithubSyncEnabled}, whose javadoc says why one named condition beats the
 * same predicate spelled out on every class).
 *
 * <p>{@code matchIfMissing} stays false, so an absent property is off, and {@code havingValue =
 * "true"} is an equality test, so exactly one string turns it on. Both are asserted in
 * {@code AnalyticsEnablementTest}.
 *
 * <p>Off means none of the annotated beans exist: no controller, so neither the two event paths
 * nor {@code /api/v1/admin/analytics} is mapped, and each answers 404 from the dispatcher. The
 * table and its migration are unconditional; only the code that reads and writes it is gated.
 */
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Documented
@ConditionalOnProperty(prefix = "app.analytics", name = "enabled", havingValue = "true")
@interface ConditionalOnAnalyticsEnabled {
}
