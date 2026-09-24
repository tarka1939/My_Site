package io.github.tarka1939.mysite;

import java.net.http.HttpClient;
import java.time.Duration;
import java.util.List;
import java.util.Map;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.http.client.ClientHttpRequestFactory;
import org.springframework.http.client.JdkClientHttpRequestFactory;
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

    /**
     * Long enough to survive a slow TCP handshake to a healthy Resend, short enough that a
     * blackholed connection fails in seconds rather than never. See the class comment.
     */
    static final Duration DEFAULT_CONNECT_TIMEOUT = Duration.ofSeconds(5);

    /**
     * Resend's send API answers in well under a second in normal operation; ten seconds is
     * generous headroom, not a working budget.
     */
    static final Duration DEFAULT_READ_TIMEOUT = Duration.ofSeconds(10);

    private final RestClient restClient;
    private final String apiKey;
    private final String fromAddress;

    /**
     * {@code @Autowired} is load-bearing, not decoration. Adding the second constructor below made
     * this a class with two candidate constructors and no annotated one, at which point Spring
     * stops guessing and looks for a no-arg constructor it will not find — every application
     * context in the suite failed to start with "No default constructor found" until this was
     * added. Compilation and the non-Spring unit tests were both perfectly happy.
     */
    @Autowired
    public ResendEmailClient(
        @Value("${app.resend.api-key:}") String apiKey,
        @Value("${app.resend.from-address}") String fromAddress
    ) {
        this(apiKey, fromAddress, RESEND_API_URL, DEFAULT_CONNECT_TIMEOUT, DEFAULT_READ_TIMEOUT);
    }

    /**
     * Package-private seam for tests, which need to point the client at a local socket. The base
     * URL is not configurable in production on purpose: there is exactly one Resend, and a
     * settable API endpoint is an exfiltration target for anyone who can influence configuration.
     */
    ResendEmailClient(
        String apiKey,
        String fromAddress,
        String apiUrl,
        Duration connectTimeout,
        Duration readTimeout
    ) {
        // Built directly via RestClient.builder() rather than an injected RestClient.Builder
        // bean: RestClientAutoConfiguration didn't register one in this Boot 4.1.0 setup
        // (another instance of the test-artifact/autoconfig fragmentation AGENT_LOG.md
        // documents elsewhere) -- the static factory sidesteps that entirely and needs
        // nothing but spring-web, which spring-boot-starter-web already provides.
        //
        // The corollary, and the reason for the explicit request factory below: Boot's
        // spring.http.client.* settings are applied by the auto-configured builder, so a client
        // built this way inherits NONE of them. spring-boot-http-client is not even on this
        // project's classpath, which is also why Boot 4's ClientHttpRequestFactoryBuilder is
        // unavailable here. Without this, both timeouts are infinite.
        this.restClient = RestClient.builder()
            .baseUrl(apiUrl)
            .requestFactory(requestFactory(connectTimeout, readTimeout))
            .build();
        this.apiKey = apiKey;
        this.fromAddress = fromAddress;
    }

    /**
     * Bounds every call to Resend in both directions.
     *
     * <p>An infinite timeout was survivable while the only caller was {@code requestReset} on the
     * request thread — the visitor was already waiting, and a hung request eventually met the
     * container's own limits. It is not survivable now. Since #186, {@code ResendEmailClient} is
     * called from {@code ContactNotificationListener} on the shared {@code taskExecutor}: if
     * Resend blackholes connections rather than refusing them, those threads hang forever, the
     * queue behind them fills and never drains, and every subsequent contact-form notification is
     * dropped until the process restarts. Nothing throws, so the listener's
     * {@code catch (RuntimeException)} never fires — the failure is invisible as well as
     * permanent.
     *
     * <p>The connect timeout lives on the JDK {@link HttpClient} (the only place it can) and the
     * read timeout on the factory. Both surface to the caller as a
     * {@code ResourceAccessException}, a {@code RuntimeException}, which is what the listener
     * already catches.
     */
    private static ClientHttpRequestFactory requestFactory(Duration connectTimeout, Duration readTimeout) {
        JdkClientHttpRequestFactory factory =
            new JdkClientHttpRequestFactory(HttpClient.newBuilder().connectTimeout(connectTimeout).build());
        factory.setReadTimeout(readTimeout);
        return factory;
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
