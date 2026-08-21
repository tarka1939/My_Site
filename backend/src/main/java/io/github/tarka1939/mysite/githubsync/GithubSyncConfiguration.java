package io.github.tarka1939.mysite.githubsync;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import tools.jackson.databind.ObjectMapper;

/**
 * The feature flag for Phase 7a, and the only place it is decided.
 *
 * <p><b>Why one predicate in one place.</b> CLAUDE.md asks Phase 7 extensions to ship behind
 * config flags; no earlier extension exists, so this establishes the pattern. It could have
 * been {@code @ConditionalOnProperty} repeated on the controller, the service and the verifier,
 * which is the more obvious spelling and also three chances to get the polarity wrong or to
 * forget one. AGENT_LOG.md's 2026-08-01 entry is about exactly that failure: a
 * {@code @Profile("!prod")} split across two classes produced a permit-all default for every
 * profile that fell between the two named cases, and it was introduced <i>by the fix for an
 * earlier fail-open finding on the same file</i>. One predicate, stated once, with the closed
 * case as the default, is what that entry argues for.
 *
 * <p><b>What "off" means: the endpoint does not exist.</b> With this class not matching, none
 * of these beans are created, no handler is mapped at {@code /api/v1/webhooks/github}, and a
 * request there gets a 404 from the dispatcher. That is a stronger guarantee than a flag
 * checked inside a handler, because there is no code path to reach -- nothing to accidentally
 * short-circuit later. {@code matchIfMissing} is left at its default of false, so an absent
 * property is off. There is no arrangement of missing configuration under which this receiver
 * accepts a payload.
 *
 * <p><b>What an unconfigured secret does: refuses to start.</b> CLAUDE.md separates an absent
 * <i>optional</i> value that degrades deliberately ({@code RESEND_API_KEY} warns and skips)
 * from a present-but-malformed one that must fail fast. A webhook secret is neither. Setting
 * {@code enabled=true} is an explicit assertion that a live receiver is wanted, and a live
 * receiver with no secret can only either reject everything (a broken endpoint that looks
 * healthy) or accept everything (a public write path into the database). So the secret is
 * treated as required <i>given</i> the opt-in: {@link GithubSignatureVerifier}'s constructor
 * throws, this bean fails, and the application refuses to boot with a message naming the
 * property. Taking down the app over a Phase 7 extension is the intended trade -- you had to
 * turn it on, and turning it back off is the documented way to run without a secret.
 */
@Configuration
@ConditionalOnProperty(prefix = "app.github-sync", name = "enabled", havingValue = "true")
class GithubSyncConfiguration {

    /**
     * Note the {@code :} default -- an empty string rather than a missing-property failure.
     * That is deliberate: a raw "could not resolve placeholder" would be a worse error message
     * than the one {@link GithubSignatureVerifier} throws, which names the property, says what
     * the consequence would have been, and gives the way out.
     */
    @Bean
    GithubSignatureVerifier githubSignatureVerifier(
        @Value("${app.github-sync.webhook-secret:}") String webhookSecret
    ) {
        return new GithubSignatureVerifier(webhookSecret);
    }

    @Bean
    GithubSyncService githubSyncService(
        GithubSyncRecordRepository repository,
        ApplicationEventPublisher eventPublisher,
        ObjectMapper objectMapper
    ) {
        return new GithubSyncService(repository, eventPublisher, objectMapper);
    }

    /**
     * A {@code @RestController} registered as a {@code @Bean} rather than component-scanned, so
     * that it comes and goes with the flag above. {@code RequestMappingHandlerMapping} inspects
     * every bean in the context for {@code @RequestMapping}, regardless of how it was
     * registered, so the mapping works exactly as it would from a scan.
     */
    @Bean
    GithubWebhookController githubWebhookController(
        GithubSignatureVerifier signatureVerifier, GithubSyncService githubSyncService
    ) {
        return new GithubWebhookController(signatureVerifier, githubSyncService);
    }
}
