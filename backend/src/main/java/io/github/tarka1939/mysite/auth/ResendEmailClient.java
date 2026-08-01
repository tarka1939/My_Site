package io.github.tarka1939.mysite.auth;

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
 * <p>If {@code RESEND_API_KEY} isn't configured, sends are skipped with a warning log rather
 * than failing the request — per the Phase 2 kickoff instructions, the reset flow shouldn't
 * block on a Resend account existing yet.
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
        if (apiKey == null || apiKey.isBlank()) {
            // resetLink embeds the raw reset token -- a credential-equivalent secret, good for
            // 30 minutes. Logging it at WARN (visible by default, including in prod) would let
            // anyone with log access reset the admin password; DEBUG is off by default in prod
            // (application-prod.yml) but on in dev, which is exactly the "let me test the flow
            // without a real Resend account" case this no-op path exists for.
            log.warn("RESEND_API_KEY not configured -- skipping password reset email send for {}", toEmail);
            log.debug("Reset link that would have been sent: {}", resetLink);
            return;
        }

        Map<String, Object> body = Map.of(
            "from", fromAddress,
            "to", List.of(toEmail),
            "subject", "Reset your My Site admin password",
            "html", "<p>A password reset was requested for your My Site admin account.</p>"
                + "<p><a href=\"" + resetLink + "\">Reset your password</a> (expires in 30 minutes).</p>"
                + "<p>If you didn't request this, you can safely ignore this email.</p>"
        );

        restClient.post()
            .header("Authorization", "Bearer " + apiKey)
            .contentType(MediaType.APPLICATION_JSON)
            .body(body)
            .retrieve()
            .toBodilessEntity();
    }
}
