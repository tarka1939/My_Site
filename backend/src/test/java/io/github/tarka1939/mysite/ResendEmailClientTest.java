package io.github.tarka1939.mysite;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.junit.jupiter.api.Assertions.assertTimeoutPreemptively;

import java.io.IOException;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.web.client.ResourceAccessException;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;

/**
 * Mostly the unconfigured-key path, where the assertions read the log rather than a mock: with no
 * key the method must return <em>before</em> the HTTP call, and the log line is the only observable
 * evidence that it did. If the guard were ever removed, those tests would fail on a real network
 * call instead of passing quietly, which is the right way round.
 *
 * <p>Nothing here reaches {@code api.resend.com}. The timeout tests at the bottom use the
 * package-private constructor's base-URL seam to point a fully configured client at a local socket
 * that accepts connections and then says nothing — the shape of a blackholing upstream, which is
 * the failure an absent read timeout turns into a permanent one.
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

    @Test
    void upstreamThatAcceptsAndNeverAnswers_failsFastRatherThanHangingForever() throws IOException {
        // The failure that matters, and the one an absent read timeout makes unrecoverable.
        // A REFUSED connection throws immediately and the listener's catch handles it; a
        // BLACKHOLED one parks the calling thread forever. Since #186 that thread belongs to the
        // shared taskExecutor, so enough of them park and the queue behind them never drains --
        // every later notification is dropped until the process restarts, with nothing thrown and
        // nothing logged. Short timeouts here only to keep the test fast; the production values
        // are asserted separately below.
        try (BlackholeServer blackhole = BlackholeServer.start()) {
            ResendEmailClient client = new ResendEmailClient(
                "re_test_key_not_real", "noreply@example.invalid", blackhole.url(),
                Duration.ofMillis(500), Duration.ofMillis(500));

            // Preemptive: without the read timeout this call never returns, so the failure mode
            // to guard against is a hang, not a wrong value. JUnit aborts and fails the test
            // instead of stalling the suite.
            assertTimeoutPreemptively(Duration.ofSeconds(15), () ->
                assertThatThrownBy(() -> client.sendContactNotificationEmail(
                    "owner@example.invalid", "New contact message from Alice", "<p>Hello</p>"))
                    // A RuntimeException, which is what ContactNotificationListener catches --
                    // so the timeout surfaces as a swallowed, logged best-effort failure rather
                    // than as anything the visitor can see.
                    .isInstanceOf(ResourceAccessException.class));
        }
    }

    @Test
    void productionTimeouts_areFiniteAndShortEnoughToMatter() {
        // The test above proves the wiring works with whatever durations it is handed; this
        // proves the durations production is handed are not accidentally infinite or absurd.
        // Both are needed: the seam that makes the first test fast is also what would let the
        // real values drift without it noticing.
        assertThat(ResendEmailClient.DEFAULT_CONNECT_TIMEOUT).isBetween(
            Duration.ofSeconds(1), Duration.ofSeconds(10));
        assertThat(ResendEmailClient.DEFAULT_READ_TIMEOUT).isBetween(
            Duration.ofSeconds(1), Duration.ofSeconds(30));
    }

    /**
     * Accepts TCP connections and then does nothing at all with them — no read, no write, no
     * close. Holds each accepted socket open so the OS does not tear it down and hand the client
     * an EOF, which would look like a different failure entirely.
     */
    private static final class BlackholeServer implements AutoCloseable {

        private final ServerSocket serverSocket;
        private final List<Socket> accepted = new CopyOnWriteArrayList<>();
        private final Thread accepter;

        private BlackholeServer(ServerSocket serverSocket) {
            this.serverSocket = serverSocket;
            this.accepter = new Thread(this::acceptForever, "blackhole-accept");
            this.accepter.setDaemon(true);
            this.accepter.start();
        }

        static BlackholeServer start() throws IOException {
            return new BlackholeServer(new ServerSocket(0, 8, InetAddress.getLoopbackAddress()));
        }

        String url() {
            return "http://127.0.0.1:" + serverSocket.getLocalPort() + "/emails";
        }

        private void acceptForever() {
            while (!serverSocket.isClosed()) {
                try {
                    accepted.add(serverSocket.accept());
                } catch (IOException e) {
                    return;
                }
            }
        }

        @Override
        public void close() throws IOException {
            serverSocket.close();
            for (Socket socket : new ArrayList<>(accepted)) {
                try {
                    socket.close();
                } catch (IOException ignored) {
                    // Best effort; the test is over either way.
                }
            }
        }
    }
}
