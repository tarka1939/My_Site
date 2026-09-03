package io.github.tarka1939.mysite;

import java.util.List;
import java.util.Map;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

/**
 * Thin wrapper around Resend's transactional email REST API (see docs/DECISIONS.md's
 * "JWT expiry and password reset flow" ADR — chosen over self-hosted SMTP for deliverability).
 *
 * <p>Lives in the application's base package rather than in {@code auth/} because it now has two
 * callers in two different modules: password reset ({@code auth}) and contact-form notification
 * ({@code contact}). Leaving it in {@code auth} would have made {@code contact} depend on the
 * auth module purely to send mail — a dependency Spring Modulith would have permitted (it is a
 * base-package type of that module, so part of its API) but which says something false about the
 * design. Email delivery is shared infrastructure, and this package is already where this project
 * keeps shared infrastructure: {@code ClientIpHasher} and {@code InMemoryRateLimiter} are here for
 * exactly the same reason, both having outgrown a single module.
 *
 * <p>If {@code RESEND_API_KEY} isn't configured, sends are skipped with a warning log rather
 * than failing the request — per the Phase 2 kickoff instructions, the reset flow shouldn't
 * block on a Resend account existing yet. This is a designed no-op for an absent optional value,
 * not a lazy check on a malformed one (CLAUDE.md's config-validation rule).
 */
@Component
public class ResendEmailClient {

    private static final Logger log = LoggerFactory.getLogger(ResendEmailClient.class);
    private static final String RESEND_API_URL = "https://api.resend.com/emails";

    private final RestClient restClient;
    private final String apiKey;
    private final String fromAddress;

    public ResendEmailClient(
        @Value("${app.resend.api-key:}") String apiKey,
        @Value("${app.resend.from-address}") String fromAddress
    ) {
        // Built directly via RestClient.builder() rather than an injected RestClient.Builder
        // bean: RestClientAutoConfiguration didn't register one in this Boot 4.1.0 setup
        // (another instance of the test-artifact/autoconfig fragmentation AGENT_LOG.md
        // documents elsewhere) -- the static factory sidesteps that entirely and needs
        // nothing but spring-web, which spring-boot-starter-web already provides.
        this.restClient = RestClient.builder().baseUrl(RESEND_API_URL).build();
        this.apiKey = apiKey;
        this.fromAddress = fromAddress;
    }

    public void sendPasswordResetEmail(String toEmail, String resetLink) {
        if (!isConfigured()) {
            // resetLink embeds the raw reset token -- a credential-equivalent secret, good for
            // 30 minutes. Logging it at WARN (visible by default, including in prod) would let
            // anyone with log access reset the admin password; DEBUG is off by default in prod
            // (application-prod.yml) but on in dev, which is exactly the "let me test the flow
            // without a real Resend account" case this no-op path exists for.
            log.warn("RESEND_API_KEY not configured -- skipping password reset email send for {}", toEmail);
            log.debug("Reset link that would have been sent: {}", resetLink);
            return;
        }

        send(toEmail, "Reset your My Site admin password",
            "<p>A password reset was requested for your My Site admin account.</p>"
                + "<p><a href=\"" + resetLink + "\">Reset your password</a> (expires in 30 minutes).</p>"
                + "<p>If you didn't request this, you can safely ignore this email.</p>");
    }

    /**
     * Sends the owner a notification that the contact form was used. Issue #186.
     *
     * <p>The subject and body are built by the caller ({@code contact}'s notification listener),
     * which owns the message format and is where the escaping of visitor-submitted content
     * lives and is tested.
     *
     * <p>Throws whatever the underlying HTTP call throws. The caller is required to treat a
     * failure here as best-effort and swallow it: the visitor's message is already committed by
     * the time this runs, and losing it because Resend had a bad minute would be far worse than
     * a missed notification.
     */
    public void sendContactNotificationEmail(String toEmail, String subject, String htmlBody) {
        if (!isConfigured()) {
            // Same designed no-op as above. Nothing is logged about the message: BOTH the
            // subject and the body carry visitor-submitted content (name, email, message text),
            // and CLAUDE.md's PII rule keeps that out of the logs. The listener logs the
            // message's UUID instead, which is a pointer into a row the admin can already read.
            log.warn("RESEND_API_KEY not configured -- skipping contact notification email");
            return;
        }

        send(toEmail, subject, htmlBody);
    }

    private boolean isConfigured() {
        return apiKey != null && !apiKey.isBlank();
    }

    private void send(String toEmail, String subject, String htmlBody) {
        Map<String, Object> body = Map.of(
            "from", fromAddress,
            "to", List.of(toEmail),
            "subject", subject,
            "html", htmlBody
        );

        restClient.post()
            .header("Authorization", "Bearer " + apiKey)
            .contentType(MediaType.APPLICATION_JSON)
            .body(body)
            .retrieve()
            .toBodilessEntity();
    }
}
