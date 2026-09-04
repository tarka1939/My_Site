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
import org.springframework.core.env.Environment;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.web.client.DefaultResponseErrorHandler;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestTemplate;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

import ch.qos.logback.classic.Level;
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
 * <p>{@link MockitoSpyBean} rather than a mock: the spy calls THROUGH to the real client, so the
 * genuine warn-and-skip path runs and the unconfigured-key degrade is a real assertion here rather
 * than something stubbed away, while the failure injection below still works.
 *
 * <p>That calling-through is only safe because {@code application-test.yml} now pins
 * {@code app.resend.api-key} blank. It previously did not: the base config reads
 * {@code ${RESEND_API_KEY:}}, so with that variable exported — which this branch's own
 * {@code docs/DEPLOYMENT.md} tells the owner to do — two of these tests would have POSTed to
 * api.resend.com against the real account and a third would have failed looking like a
 * regression. {@link #testProfilePinsTheResendKeyBlank_soTheSuiteCannotSendRealEmail()} guards it.
 */
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = "app.contact.notification-email=owner@example.invalid")
@Testcontainers
@ActiveProfiles("test")
class ContactNotificationIntegrationTest {

    private static final String OWNER = "owner@example.invalid";

    /** Mirrors ContactService's MAX_MESSAGES_PER_WINDOW. */
    private static final int MAX_MESSAGES_PER_IP_PER_HOUR = 5;

    @Container
    @ServiceConnection
    static PostgreSQLContainer postgres = new PostgreSQLContainer("postgres:17-alpine");

    @LocalServerPort
    private int port;

    @Autowired
    private ContactMessageRepository contactMessageRepository;

    @MockitoSpyBean
    private ResendEmailClient resendEmailClient;

    @Autowired
    private Environment environment;

    @Autowired
    private ThreadPoolTaskExecutor taskExecutor;

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

    @Test
    void saturatedExecutor_dropsTheNotificationQuietlyAndStillReturns201() {
        // The listener's try/catch cannot protect the @Async DISPATCH, which happens before the
        // method body: AsyncExecutionAspectSupport calls executor.submit() on the caller's thread,
        // and under AFTER_COMMIT that caller is the thread committing the visitor's request. With
        // the JDK default AbortPolicy that submit threw TaskRejectedException there.
        //
        // What that costs was MEASURED rather than reasoned about, and the answer is not the one
        // PR #190's review expected. It does not become a 500: Spring 7.0.8's
        // PlatformSynchronization has no afterCommit() override and dispatches AFTER_COMMIT from
        // afterCompletion(), which TransactionSynchronizationUtils wraps in a catch-and-log. So
        // the 201 assertions below held before the fix too, and are a regression guard rather
        // than the thing this test proves.
        //
        // What it costs is the ERROR-level stack trace per dropped notification, asserted against
        // below -- a saturated queue is a capacity condition, and logging it as an error buries
        // the signal that would matter. AsyncConfigTest pins the executor's own behaviour, which
        // is where the deterministic before/after difference lives.
        ListAppender<ILoggingEvent> everything = attachToRootLogger();
        CountDownLatch release = new CountDownLatch(1);
        doAnswer(invocation -> {
            release.await(60, TimeUnit.SECONDS);
            return null;
        }).when(resendEmailClient).sendContactNotificationEmail(anyString(), anyString(), anyString());

        try {
            // 8 max threads + a 50-slot queue = 58 tasks absorbed, so submissions from the 59th on
            // are the ones that can be rejected. 70 leaves margin without being slow.
            for (int i = 0; i < 70; i++) {
                if (i % MAX_MESSAGES_PER_IP_PER_HOUR == 0) {
                    // ContactService's rate limiter counts rows, so emptying the table refunds the
                    // quota. Relied on deliberately here: the limiter caps a single IP at five an
                    // hour, and every request in this test comes from 127.0.0.1, so there is no
                    // other way to reach saturation over real HTTP. (That the refund exists at all
                    // is a known, accepted weakness -- see this PR's description.)
                    contactMessageRepository.deleteAll();
                }
                ResponseEntity<String> response =
                    submit("Visitor " + i, "visitor" + i + "@example.invalid", "Message " + i);
                assertThat(response.getStatusCode())
                    .as("submission %d must still be a 201 -- the message is committed by the time "
                        + "the notification is even dispatched", i)
                    .isEqualTo(HttpStatus.CREATED);
            }

            // Asserted before the saturation check below so that a regression here reports the
            // defect rather than its symptom: with no rejection handler this list holds one
            // TaskRejectedException stack trace per dropped notification, logged by
            // TransactionSynchronizationUtils.
            assertThat(eventsAtLevel(everything, Level.ERROR))
                .as("overflow is a capacity condition, not an error -- nothing here should be "
                    + "logged at a level that reads as 'something is broken, go and look'")
                .isEmpty();

            // ...and the test is only meaningful if it actually filled the executor. Without this
            // it would keep passing after a pool-size change that made 70 submissions absorbable,
            // asserting nothing at all.
            assertThat(messagesAtLevel(everything, Level.WARN))
                .as("70 submissions against an 8-thread, 50-slot executor must overflow it")
                .anyMatch(m -> m.contains("Async task executor saturated"));
        } finally {
            release.countDown();
            // Drain before returning, or the ~50 queued tasks land on the spy after Mockito has
            // reset it and break a later test's verify() count. Cheap once the latch is open.
            awaitExecutorIdle();
            detachFromRootLogger(everything);
        }
    }

    @Test
    void testProfilePinsTheResendKeyBlank_soTheSuiteCannotSendRealEmail() {
        // Reads the RESOLVED property rather than the yml file, because the hole this guards is
        // precisely that an environment variable outranks a file that stays silent. This assertion
        // fails in exactly the environment where the bug bit: RESEND_API_KEY exported, pin gone.
        assertThat(environment.getProperty("app.resend.api-key"))
            .as("app.resend.api-key must be pinned blank in the test profile -- the spy above calls "
                + "through to the real client, so a resolvable key means this suite emails people")
            .isBlank();
    }

    private static ListAppender<ILoggingEvent> attachToRootLogger() {
        ListAppender<ILoggingEvent> appender = new ListAppender<>();
        appender.start();
        ((Logger) LoggerFactory.getLogger(org.slf4j.Logger.ROOT_LOGGER_NAME)).addAppender(appender);
        return appender;
    }

    private static void detachFromRootLogger(ListAppender<ILoggingEvent> appender) {
        ((Logger) LoggerFactory.getLogger(org.slf4j.Logger.ROOT_LOGGER_NAME)).detachAppender(appender);
    }

    private static List<ILoggingEvent> eventsAtLevel(ListAppender<ILoggingEvent> appender, Level level) {
        return List.copyOf(appender.list).stream().filter(e -> e.getLevel().equals(level)).toList();
    }

    private static List<String> messagesAtLevel(ListAppender<ILoggingEvent> appender, Level level) {
        return eventsAtLevel(appender, level).stream().map(ILoggingEvent::getFormattedMessage).toList();
    }

    private void awaitExecutorIdle() {
        long deadline = System.nanoTime() + Duration.ofSeconds(30).toNanos();
        while (System.nanoTime() < deadline) {
            if (taskExecutor.getThreadPoolExecutor().getQueue().isEmpty()
                && taskExecutor.getActiveCount() == 0) {
                return;
            }
            try {
                Thread.sleep(25);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new IllegalStateException(e);
            }
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
