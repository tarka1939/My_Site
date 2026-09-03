package io.github.tarka1939.mysite.contact;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;

import java.time.Duration;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.web.client.DefaultResponseErrorHandler;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestTemplate;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import io.github.tarka1939.mysite.ResendEmailClient;

/**
 * Issue #186 end to end: real HTTP, the real security filter chain, a real Postgres, a real
 * transaction that really commits, and the real {@code @Async} executor.
 *
 * <p><strong>Deliberately not {@code @Transactional}.</strong> The listener is bound to
 * {@code AFTER_COMMIT}, so a test that rolls back would never fire it and would pass while
 * asserting nothing. Rows therefore survive each test, which is also why {@link #reset()} empties
 * the table — the contact rate limiter counts rows, so leftovers from one test would 429 the next.
 *
 * <p>{@link MockitoSpyBean} rather than a mock: the spy calls through to the real client, whose
 * {@code RESEND_API_KEY} is blank in the test profile, so the genuine warn-and-skip path runs and
 * nothing touches the network. That makes the unconfigured-key degrade a real assertion here
 * rather than something stubbed away, while still allowing the failure injection below.
 */
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = "app.contact.notification-email=owner@example.invalid")
@Testcontainers
@ActiveProfiles("test")
class ContactNotificationIntegrationTest {

    private static final String OWNER = "owner@example.invalid";

    @Container
    @ServiceConnection
    static PostgreSQLContainer postgres = new PostgreSQLContainer("postgres:17-alpine");

    @LocalServerPort
    private int port;

    @Autowired
    private ContactMessageRepository contactMessageRepository;

    @MockitoSpyBean
    private ResendEmailClient resendEmailClient;

    /**
     * Plain RestTemplate with the errors turned off rather than TestRestTemplate, matching
     * GithubWebhookIntegrationTest: this Boot 4.1.0 setup does not put TestRestTemplate on the
     * test classpath. Non-throwing so an unexpected status fails as a readable assertion instead
     * of an exception thrown from the call itself.
     */
    private final RestTemplate restTemplate = nonThrowingRestTemplate();

    private Logger emailClientLogger;
    private ListAppender<ILoggingEvent> appender;

    @BeforeEach
    void reset() {
        contactMessageRepository.deleteAll();
        emailClientLogger = (Logger) LoggerFactory.getLogger(ResendEmailClient.class);
        appender = new ListAppender<>();
        appender.start();
        emailClientLogger.addAppender(appender);
    }

    @AfterEach
    void releaseLogs() {
        emailClientLogger.detachAppender(appender);
    }

    @Test
    void submission_isPersistedAcknowledgedAndNotified() {
        ResponseEntity<String> response = submit("Alice", "alice@example.invalid", "Hello there");

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        assertThat(contactMessageRepository.count()).isEqualTo(1);

        // timeout(): the listener is @Async, so it runs on the taskExecutor thread after the
        // response has already gone back to the visitor. That ordering is the feature.
        ArgumentCaptor<String> to = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> subject = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> body = ArgumentCaptor.forClass(String.class);
        verify(resendEmailClient, timeout(10_000))
            .sendContactNotificationEmail(to.capture(), subject.capture(), body.capture());

        assertThat(to.getValue()).isEqualTo(OWNER);
        assertThat(subject.getValue()).isEqualTo("New contact message from Alice");
        assertThat(body.getValue()).contains("Hello there").contains("alice@example.invalid");
    }

    @Test
    void resendUnconfigured_stillPersistsAcknowledgesAndDegradesToWarnAndSkip() {
        // RESEND_API_KEY is blank in the test profile, and the spy calls through, so this
        // exercises the designed no-op rather than a stub of it.
        ResponseEntity<String> response = submit("Bob", "bob@example.invalid", "Anyone home?");

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        assertThat(contactMessageRepository.count()).isEqualTo(1);

        verify(resendEmailClient, timeout(10_000))
            .sendContactNotificationEmail(anyString(), anyString(), anyString());
        // Polled rather than read once: Mockito records the invocation on the spy BEFORE calling
        // through, so the verify above can win the race against the real method's own log line.
        awaitLogMessageContaining("RESEND_API_KEY not configured");
    }

    @Test
    void resendThrowing_doesNotCostTheMessageOrChangeTheResponse() {
        // The point of the exercise, and the shape AGENT_LOG.md records shipping once in
        // PasswordResetService.requestReset: a third party having a bad minute must not reach
        // the visitor's response, and must certainly not lose their message.
        doThrow(new RestClientException("resend is down"))
            .when(resendEmailClient).sendContactNotificationEmail(anyString(), anyString(), anyString());

        ResponseEntity<String> response = submit("Carol", "carol@example.invalid", "Important enquiry");

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CREATED);

        ContactMessage saved = contactMessageRepository.findAll().getFirst();
        assertThat(saved.getName()).isEqualTo("Carol");
        assertThat(saved.getMessage()).isEqualTo("Important enquiry");

        // And the send really was attempted -- otherwise this would pass for the wrong reason,
        // with the listener silently never running at all.
        verify(resendEmailClient, timeout(10_000))
            .sendContactNotificationEmail(anyString(), anyString(), anyString());
    }

    @Test
    void slowResend_doesNotHoldTheVisitorsResponseOpen() {
        // Guards the @Async half specifically. Without it the listener would still be correct --
        // AFTER_COMMIT plus the catch keeps the message safe and the status 201 -- but it would run
        // on the request thread, so a hanging Resend call would hang the visitor. A mutation run
        // proved the rest of this class cannot tell the difference; this test can.
        CountDownLatch release = new CountDownLatch(1);
        doAnswer(invocation -> {
            release.await(30, TimeUnit.SECONDS);
            return null;
        }).when(resendEmailClient).sendContactNotificationEmail(anyString(), anyString(), anyString());

        try {
            long startedAt = System.nanoTime();
            ResponseEntity<String> response = submit("Dave", "dave@example.invalid", "Are you there?");
            Duration elapsed = Duration.ofNanos(System.nanoTime() - startedAt);

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CREATED);
            // Generous: the request itself takes milliseconds, and the stub blocks for 30 seconds.
            // Anything under this margin means the send was not on the request thread.
            assertThat(elapsed).isLessThan(Duration.ofSeconds(10));
            assertThat(contactMessageRepository.count()).isEqualTo(1);

            // ...and it really is in flight on the executor, rather than never having run.
            verify(resendEmailClient, timeout(10_000))
                .sendContactNotificationEmail(anyString(), anyString(), anyString());
        } finally {
            // Always, or a taskExecutor thread stays blocked for the rest of the suite.
            release.countDown();
        }
    }

    private ResponseEntity<String> submit(String name, String email, String message) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        String json = """
            {"name":"%s","email":"%s","message":"%s"}""".formatted(name, email, message);
        return restTemplate.postForEntity(
            "http://localhost:" + port + "/api/v1/contact", new HttpEntity<>(json, headers), String.class);
    }

    private static RestTemplate nonThrowingRestTemplate() {
        RestTemplate template = new RestTemplate();
        template.setErrorHandler(new DefaultResponseErrorHandler() {
            @Override
            public boolean hasError(org.springframework.http.client.ClientHttpResponse response) {
                return false;
            }
        });
        return template;
    }

    private void awaitLogMessageContaining(String fragment) {
        long deadline = System.nanoTime() + Duration.ofSeconds(10).toNanos();
        while (System.nanoTime() < deadline) {
            if (logMessages().stream().anyMatch(m -> m.contains(fragment))) {
                return;
            }
            try {
                Thread.sleep(25);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new IllegalStateException(e);
            }
        }
        assertThat(logMessages()).anyMatch(m -> m.contains(fragment));
    }

    private List<String> logMessages() {
        return List.copyOf(appender.list).stream().map(ILoggingEvent::getFormattedMessage).toList();
    }
}
