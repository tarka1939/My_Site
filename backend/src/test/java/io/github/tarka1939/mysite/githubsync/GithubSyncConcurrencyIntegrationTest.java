package io.github.tarka1939.mysite.githubsync;

import static io.github.tarka1939.mysite.githubsync.GithubWebhookTestSupport.SECRET;
import static io.github.tarka1939.mysite.githubsync.GithubWebhookTestSupport.payload;
import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.stream.IntStream;

import javax.sql.DataSource;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

/**
 * The check-then-act race, tested where it can actually be observed.
 *
 * <p>This class exists because of a measured failure, not a hunch. The first attempt fired
 * twelve simultaneous <i>HTTP</i> requests at the receiver and asserted one record came out. It
 * passed -- and it went on passing when the implementation was deliberately mutated to the naive
 * "does this delivery id exist? no? then insert" that the whole ON CONFLICT design exists to
 * avoid. A test that green-lights the bug it was written to catch is worse than no test, because
 * it is cited as evidence.
 *
 * <p>The reason it passed is jitter. The window a pre-check leaves open is one database round
 * trip -- a few hundred microseconds. The spread in when twelve HTTP requests actually reach
 * their handler is larger than that, so the racers arrive in single file no matter how precisely
 * they were released. Calling the service directly removes connection setup, request parsing and
 * Tomcat's scheduling from between the barrier and the critical section, which leaves the
 * threads genuinely overlapping. Several rounds compound the odds further.
 *
 * <p>Verified in both directions rather than assumed: with the atomic insert this passes, and
 * with the pre-check substituted it fails on the very first round. The HTTP-level test is kept
 * in {@code GithubWebhookIdempotencyIntegrationTest} for what it does show -- that concurrent
 * deliveries end-to-end produce one record and one event -- but it is not the race proof, and
 * that class says so.
 */
@SpringBootTest(properties = {
    "app.github-sync.enabled=true",
    "app.github-sync.webhook-secret=" + SECRET
})
@Testcontainers
@ActiveProfiles("test")
@Import(GithubWebhookTestSupport.RecordingListenerConfiguration.class)
class GithubSyncConcurrencyIntegrationTest {

    private static final int RACERS = 16;
    private static final int ROUNDS = 5;

    @Container
    @ServiceConnection
    static PostgreSQLContainer postgres = new PostgreSQLContainer("postgres:17-alpine");

    @Autowired
    private GithubSyncService githubSyncService;

    @Autowired
    private DataSource dataSource;

    @Autowired
    private GithubWebhookTestSupport.RecordingListener recordingListener;

    @BeforeEach
    void resetRecordedEvents() {
        recordingListener.clear();
    }

    /** What one racer came back with: an ack, or the exception that replaced it. */
    private record Outcome(GithubWebhookAck ack, Throwable failure) {
    }

    @Test
    void concurrentAcceptsOfOneDeliveryIdInsertExactlyOnce() throws Exception {
        byte[] body = payload("{\"repository\":{\"full_name\":\"tarka1939/My_Site\"}}");

        try (ExecutorService pool = Executors.newFixedThreadPool(RACERS)) {
            for (int round = 0; round < ROUNDS; round++) {
                String deliveryId = UUID.randomUUID().toString();
                CyclicBarrier releaseTogether = new CyclicBarrier(RACERS);

                List<Outcome> outcomes = IntStream.range(0, RACERS)
                    .mapToObj(i -> CompletableFuture.supplyAsync(() -> {
                        try {
                            releaseTogether.await(30, TimeUnit.SECONDS);
                        } catch (Exception e) {
                            throw new IllegalStateException("barrier", e);
                        }
                        try {
                            return new Outcome(githubSyncService.accept(deliveryId, "push", body), null);
                        } catch (Throwable t) {
                            // A pre-check implementation lands here: the losing racers' INSERTs
                            // hit the unique index and blow up rather than reporting "duplicate".
                            return new Outcome(null, t);
                        }
                    }, pool))
                    .toList()
                    .stream()
                    .map(CompletableFuture::join)
                    .toList();

                String context = "round " + round + " of " + ROUNDS;

                assertThat(outcomes)
                    .as("%s: no racer may fail -- a constraint violation reaching the caller means "
                        + "the insert was not atomic", context)
                    .allSatisfy(outcome -> assertThat(outcome.failure()).isNull());

                assertThat(outcomes.stream()
                    .filter(o -> o.ack().status() == GithubWebhookAck.Status.RECORDED)
                    .count())
                    .as("%s: exactly one racer may be told it recorded the delivery", context)
                    .isEqualTo(1);

                assertThat(outcomes.stream()
                    .filter(o -> o.ack().status() == GithubWebhookAck.Status.DUPLICATE)
                    .count())
                    .as("%s: every other racer must be told it was a duplicate", context)
                    .isEqualTo(RACERS - 1L);

                assertThat(countRecordsFor(deliveryId))
                    .as("%s: one row, enforced by the unique index rather than by a check", context)
                    .isEqualTo(1);

                assertThat(recordingListener.events().stream()
                    .filter(e -> e.deliveryId().equals(deliveryId))
                    .count())
                    .as("%s: exactly one event per accepted delivery, not one per call", context)
                    .isEqualTo(1);
            }
        }
    }

    private long countRecordsFor(String deliveryId) {
        return new JdbcTemplate(dataSource).queryForObject(
            "SELECT count(*) FROM github_sync_record WHERE github_delivery_id = ?",
            Long.class, deliveryId);
    }
}
