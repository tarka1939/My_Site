package io.github.tarka1939.mysite;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;

import java.util.List;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;

/**
 * The unconfigured-key path only. Anything that actually reaches api.resend.com is out of scope
 * for a unit test, and there is no seam to intercept it — {@link ResendEmailClient} builds its own
 * {@code RestClient} for the autoconfiguration reason documented on its constructor.
 *
 * <p>That is exactly why these assertions read the log rather than a mock: with no key the method
 * must return <em>before</em> the HTTP call, and the log line is the only observable evidence that
 * it did. If the guard were ever removed, this test would hang or fail on a real network call
 * instead of passing quietly, which is the right way round.
 */
class ResendEmailClientTest {

    private Logger clientLogger;
    private ListAppender<ILoggingEvent> appender;

    @BeforeEach
    void captureLogs() {
        clientLogger = (Logger) LoggerFactory.getLogger(ResendEmailClient.class);
        appender = new ListAppender<>();
        appender.start();
        clientLogger.addAppender(appender);
        clientLogger.setLevel(Level.DEBUG);
    }

    @AfterEach
    void releaseLogs() {
        clientLogger.detachAppender(appender);
        clientLogger.setLevel(null);
    }

    @Test
    void contactNotification_withNoApiKey_warnsAndSkipsInsteadOfFailing() {
        // The designed no-op CLAUDE.md's config-validation rule calls for on an absent optional
        // value. A fresh checkout has no RESEND_API_KEY and must still be able to run the
        // contact form end to end.
        ResendEmailClient client = new ResendEmailClient("", "noreply@example.invalid");

        assertThatCode(() -> client.sendContactNotificationEmail(
            "owner@example.invalid", "New contact message from Alice", "<p>Hello there</p>"))
            .doesNotThrowAnyException();

        assertThat(warnings()).anyMatch(m -> m.contains("RESEND_API_KEY not configured"));
    }

    @Test
    void contactNotification_withNoApiKey_logsNothingAboutTheVisitor() {
        ResendEmailClient client = new ResendEmailClient(null, "noreply@example.invalid");

        client.sendContactNotificationEmail(
            "owner@example.invalid",
            "New contact message from Alice Visitor",
            "<p>alice@visitor.invalid</p><blockquote>my secret message</blockquote>");

        // Both the subject and the body carry visitor-submitted content, so neither may reach the
        // log at ANY level -- not merely at the levels prod enables. Captured at DEBUG here on
        // purpose, so that a future "helpful" debug line would fail this test rather than ship.
        assertThat(allMessages()).isNotEmpty();
        assertThat(allMessages()).noneMatch(m -> m.contains("Alice Visitor"));
        assertThat(allMessages()).noneMatch(m -> m.contains("alice@visitor.invalid"));
        assertThat(allMessages()).noneMatch(m -> m.contains("my secret message"));
    }

    @Test
    void passwordReset_withNoApiKey_stillKeepsTheResetLinkOutOfWarnLevel() {
        // Guards the fix recorded in AGENT_LOG.md (the raw reset link was once logged at WARN).
        // Re-asserted here because moving this class between packages is exactly the kind of
        // change that can quietly undo it.
        ResendEmailClient client = new ResendEmailClient("", "noreply@example.invalid");

        client.sendPasswordResetEmail("admin@example.invalid", "https://site.invalid/reset?token=SECRET");

        assertThat(warnings()).noneMatch(m -> m.contains("SECRET"));
        assertThat(messagesAtLevel(Level.DEBUG)).anyMatch(m -> m.contains("SECRET"));
    }

    private List<String> warnings() {
        return messagesAtLevel(Level.WARN);
    }

    private List<String> messagesAtLevel(Level level) {
        return appender.list.stream()
            .filter(e -> e.getLevel().equals(level))
            .map(ILoggingEvent::getFormattedMessage)
            .toList();
    }

    private List<String> allMessages() {
        return appender.list.stream().map(ILoggingEvent::getFormattedMessage).toList();
    }
}
