package io.github.tarka1939.mysite.githubsync;

import static io.github.tarka1939.mysite.githubsync.GithubWebhookTestSupport.SECRET;
import static io.github.tarka1939.mysite.githubsync.GithubWebhookTestSupport.headers;
import static io.github.tarka1939.mysite.githubsync.GithubWebhookTestSupport.nonThrowingRestTemplate;
import static io.github.tarka1939.mysite.githubsync.GithubWebhookTestSupport.payload;
import static io.github.tarka1939.mysite.githubsync.GithubWebhookTestSupport.sign;
import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import javax.sql.DataSource;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.web.client.RestTemplate;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

/**
 * Idempotency on {@code X-GitHub-Delivery} (issue #55), against a real Postgres -- which is the
 * only place it can be tested, since the guard is a unique index and not application logic.
 */
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = {
        "app.github-sync.enabled=true",
        "app.github-sync.webhook-secret=" + SECRET
    })
@Testcontainers
@ActiveProfiles("test")
@Import(GithubWebhookTestSupport.RecordingListenerConfiguration.class)
class GithubWebhookIdempotencyIntegrationTest {

    /** How many simultaneous redeliveries the concurrency test fires. */
    private static final int CONCURRENT_REDELIVERIES = 12;

    @Container
    @ServiceConnection
    static PostgreSQLContainer postgres = new PostgreSQLContainer("postgres:17-alpine");

    @LocalServerPort
    private int port;

    @Autowired
    private GithubSyncRecordRepository repository;

    @Autowired
    private DataSource dataSource;

    @Autowired
    private GithubWebhookTestSupport.RecordingListener recordingListener;

    private final RestTemplate restTemplate = nonThrowingRestTemplate();

    @BeforeEach
    void resetRecordedEvents() {
        recordingListener.clear();
    }

    private ResponseEntity<String> deliver(byte[] body, String deliveryId) {
        return restTemplate.postForEntity(
            "http://localhost:" + port + "/api/v1/webhooks/github",
            new HttpEntity<>(body, headers(sign(body), deliveryId, "push")),
            String.class);
    }

    private long countRecordsFor(String deliveryId) {
        return new JdbcTemplate(dataSource).queryForObject(
            "SELECT count(*) FROM github_sync_record WHERE github_delivery_id = ?",
            Long.class, deliveryId);
    }

    private List<GithubDeliveryReceivedEvent> eventsFor(String deliveryId) {
        return recordingListener.events().stream()
            .filter(event -> event.deliveryId().equals(deliveryId))
            .toList();
    }

    /**
     * CLAUDE.md's migration-completeness rule wants a supporting index for every query on a
     * non-primary-key column, and the brief for this work said to <i>check</i> that the unique
     * constraint brings one rather than assume it. So this asks Postgres. It is also the
     * assertion that would fail if a future migration replaced the unique index with an
     * application-level check -- which would take the idempotency guard away without changing
     * a single test that only looks at behaviour under low concurrency.
     */
    @Test
    void theUniqueIndexBackingIdempotencyExists() {
        List<String> indexDefinitions = new JdbcTemplate(dataSource).queryForList(
            "SELECT indexdef FROM pg_indexes WHERE tablename = 'github_sync_record'",
            String.class);

        assertThat(indexDefinitions)
            .as("the unique index on github_delivery_id is the idempotency guard, and doubles "
                + "as the supporting index for findByGithubDeliveryId")
            .anyMatch(definition ->
                definition.contains("CREATE UNIQUE INDEX")
                    && definition.contains("ux_github_sync_record_delivery_id")
                    && definition.contains("github_delivery_id"));
    }

    @Test
    void aRedeliveredDeliveryIdIsRecordedOnceAndPublishesOneEvent() {
        byte[] body = payload("{\"repository\":{\"full_name\":\"tarka1939/My_Site\"}}");
        String deliveryId = UUID.randomUUID().toString();

        ResponseEntity<String> first = deliver(body, deliveryId);
        ResponseEntity<String> second = deliver(body, deliveryId);

        assertThat(first.getStatusCode()).isEqualTo(HttpStatus.ACCEPTED);
        assertThat(first.getBody()).contains("\"status\":\"recorded\"");

        // Still 2xx: from GitHub's side "already had it" also means stop retrying.
        assertThat(second.getStatusCode()).isEqualTo(HttpStatus.ACCEPTED);
        assertThat(second.getBody()).contains("\"status\":\"duplicate\"");

        assertThat(countRecordsFor(deliveryId)).isEqualTo(1);
        assertThat(eventsFor(deliveryId)).hasSize(1);
    }

    /**
     * A replay whose <i>body</i> differs is still one delivery id, so still one record. GitHub
     * would not do this, but it is the case that separates "idempotent on the delivery id" from
     * "deduplicating identical requests", and the column the unique index sits on decides which
     * of those this is.
     */
    @Test
    void idempotencyKeysOnTheDeliveryIdRatherThanTheBody() {
        String deliveryId = UUID.randomUUID().toString();

        deliver(payload("{\"repository\":{\"full_name\":\"tarka1939/My_Site\"}}"), deliveryId);
        ResponseEntity<String> second =
            deliver(payload("{\"repository\":{\"full_name\":\"someone/else\"}}"), deliveryId);

        assertThat(second.getBody()).contains("\"status\":\"duplicate\"");
        assertThat(countRecordsFor(deliveryId)).isEqualTo(1);
        // The first body won; the replay did not overwrite it.
        assertThat(repository.findByGithubDeliveryId(deliveryId))
            .get()
            .extracting(GithubSyncRecord::getRepoFullName)
            .isEqualTo("tarka1939/My_Site");
    }

    @Test
    void distinctDeliveryIdsEachGetTheirOwnRecordAndEvent() {
        byte[] body = payload("{\"repository\":{\"full_name\":\"tarka1939/My_Site\"}}");
        String first = UUID.randomUUID().toString();
        String second = UUID.randomUUID().toString();

        assertThat(deliver(body, first).getBody()).contains("\"status\":\"recorded\"");
        assertThat(deliver(body, second).getBody()).contains("\"status\":\"recorded\"");

        assertThat(eventsFor(first)).hasSize(1);
        assertThat(eventsFor(second)).hasSize(1);
    }

    /**
     * The test that matters, and the one the sequential replay above cannot stand in for.
     *
     * <p>An implementation that asks "have I already seen this delivery id?" and then inserts
     * passes the sequential test perfectly -- by the time the second request arrives, the first
     * has committed and the pre-check sees it. It fails here, because all
     * {@value #CONCURRENT_REDELIVERIES} requests read "no" before any of them writes, and every
     * one of them proceeds to insert. That is the check-then-act shape CLAUDE.md lists as a
     * standing risk in this codebase, and it is ordinary traffic for a webhook: GitHub retries
     * on its own schedule and a human can click Redeliver while a retry is already in flight.
     *
     * <p>A {@link CyclicBarrier} releases every thread at once, so they overlap rather than
     * merely running on different threads.
     */
    @Test
    void concurrentRedeliveriesOfTheSameIdProduceOneRecordAndOneEvent() throws Exception {
        byte[] body = payload("{\"repository\":{\"full_name\":\"tarka1939/My_Site\"}}");
        String deliveryId = UUID.randomUUID().toString();
        CyclicBarrier startTogether = new CyclicBarrier(CONCURRENT_REDELIVERIES);

        try (ExecutorService pool = Executors.newFixedThreadPool(CONCURRENT_REDELIVERIES)) {
            List<CompletableFuture<String>> responses = java.util.stream.IntStream
                .range(0, CONCURRENT_REDELIVERIES)
                .mapToObj(i -> CompletableFuture.supplyAsync(() -> {
                    try {
                        startTogether.await(30, TimeUnit.SECONDS);
                    } catch (Exception e) {
                        throw new IllegalStateException(e);
                    }
                    ResponseEntity<String> response = deliver(body, deliveryId);
                    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.ACCEPTED);
                    return response.getBody();
                }, pool))
                .toList();

            List<String> bodies = responses.stream().map(CompletableFuture::join).toList();

            assertThat(bodies.stream().filter(b -> b.contains("\"status\":\"recorded\"")).count())
                .as("exactly one racer may win")
                .isEqualTo(1);
            assertThat(bodies.stream().filter(b -> b.contains("\"status\":\"duplicate\"")).count())
                .isEqualTo(CONCURRENT_REDELIVERIES - 1);
        }

        assertThat(countRecordsFor(deliveryId))
            .as("the unique index is what makes this 1, not a pre-check")
            .isEqualTo(1);
        assertThat(eventsFor(deliveryId))
            .as("exactly one event per accepted delivery, not one per request")
            .hasSize(1);
    }
}
