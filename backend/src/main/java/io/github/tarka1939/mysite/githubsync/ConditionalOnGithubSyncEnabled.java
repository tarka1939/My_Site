package io.github.tarka1939.mysite.githubsync;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;

/**
 * The Phase 7a feature flag, defined once and applied by name.
 *
 * <p>CLAUDE.md asks Phase 7 extensions to ship behind config flags so the core CMS can ship
 * while they are half-built; no earlier extension exists, so this establishes the pattern. The
 * pattern is deliberately <i>a named condition rather than a repeated one</i>. AGENT_LOG.md's
 * 2026-08-01 entry is about a {@code @Profile} predicate spelled out separately on two classes,
 * where the two named cases did not meet and every profile falling between them got permit-all
 * -- and that gap was introduced by the fix for an earlier fail-open finding on the same file.
 * Writing {@code @ConditionalOnProperty(prefix = "app.github-sync", name = "enabled",
 * havingValue = "true")} on three classes would be three chances to make that mistake. Written
 * this way there is one predicate, and the classes that share it say so.
 *
 * <p>{@code matchIfMissing} is left at its default of false, so an absent property is off, and
 * {@code havingValue = "true"} is an equality test rather than a truthiness one, so there is
 * exactly one string that turns this on. Both are asserted in
 * {@code GithubSyncEnablementTest}.
 *
 * <p>Off means the annotated beans do not exist: no controller, so no handler mapped at
 * {@code /api/v1/webhooks/github}, so a 404 from the dispatcher. That is stronger than a flag
 * checked inside a handler, because there is no code path to reach and nothing later to
 * short-circuit by accident. Forgetting this annotation on one of the three classes fails
 * loudly rather than open -- the context cannot satisfy the missing dependency and the
 * application does not start.
 */
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Documented
@ConditionalOnProperty(prefix = "app.github-sync", name = "enabled", havingValue = "true")
public @interface ConditionalOnGithubSyncEnabled {
}
