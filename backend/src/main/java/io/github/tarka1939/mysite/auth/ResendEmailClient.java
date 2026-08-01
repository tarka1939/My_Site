package io.github.tarka1939.mysite.auth;

import java.util.Map;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
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
            log.warn("RESEND_API_KEY not configured -- skipping password reset email send (link would have been: {})", resetLink);
            return;
        }

        Map<String, Object> body = Map.of(
            "from", fromAddress,
            "to", java.util.List.of(toEmail),
            "subject", "Reset your My Site admin password",
            "html", "<p>A password reset was requested for your My Site admin account.</p>"
                + "<p><a href=\"" + resetLink + "\">Reset your password</a> (expires in 30 minutes).</p>"
                + "<p>If you didn't request this, you can safely ignore this email.</p>"
        );

        restClient.post()
            .header("Authorization", "Bearer " + apiKey)
            .contentType(org.springframework.http.MediaType.APPLICATION_JSON)
            .body(body)
            .retrieve()
            .toBodilessEntity();
    }
}
