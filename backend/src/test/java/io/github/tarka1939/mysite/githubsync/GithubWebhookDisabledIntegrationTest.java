package io.github.tarka1939.mysite.githubsync;

import static io.github.tarka1939.mysite.githubsync.GithubWebhookTestSupport.headers;
import static io.github.tarka1939.mysite.githubsync.GithubWebhookTestSupport.nonThrowingRestTemplate;
import static io.github.tarka1939.mysite.githubsync.GithubWebhookTestSupport.payload;
import static io.github.tarka1939.mysite.githubsync.GithubWebhookTestSupport.sign;
import static org.assertj.core.api.Assertions.assertThat;

import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.ApplicationContext;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.web.client.RestTemplate;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

import javax.sql.DataSource;

/**
 * The flag in its off position, through real HTTP.
 *
 * <p>Note there is no {@code webhook-secret} property here at all -- the whole point is that a
 * disabled receiver needs no secret and boots perfectly happily without one. That combination
 * is what {@code application.yml} ships as the default, so this is also the test that the
 * shipped defaults produce a working application with no webhook endpoint, rather than a
 * failure or an open door.
 */
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = "app.github-sync.enabled=false")
@Testcontainers
@ActiveProfiles("test")
class GithubWebhookDisabledIntegrationTest {

    @Container
    @ServiceConnection
    static PostgreSQLContainer postgres = new PostgreSQLContainer("postgres:17-alpine");

    @LocalServerPort
    private int port;

    @Autowired
    private ApplicationContext applicationContext;

    @Autowired
    private DataSource dataSource;

    private final RestTemplate restTemplate = nonThrowingRestTemplate();

    /**
     * A correctly signed delivery -- signed with a secret the application does not even have
     * configured -- still gets nothing. There is no handler to reach.
     *
     * <p>404 rather than 401 is also the proof that {@code SecurityConfig}'s permit case works:
     * had the filter chain been rejecting this, it would be a 401 and this test would pass for
     * the wrong reason on a receiver that was in fact wide open once enabled.
     */
    @Test
    void aCorrectlySignedDeliveryGets404WhenTheFlagIsOff() {
        byte[] body = payload("{\"repository\":{\"full_name\":\"tarka1939/My_Site\"}}");

        ResponseEntity<String> response = restTemplate.postForEntity(
            "http://localhost:" + port + "/api/v1/webhooks/github",
            new HttpEntity<>(body, headers(sign(body), UUID.randomUUID().toString(), "push")),
            String.class);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
    }

    @Test
    void noneOfTheReceiverBeansExist() {
        assertThat(applicationContext.getBeanNamesForType(GithubWebhookController.class)).isEmpty();
        assertThat(applicationContext.getBeanNamesForType(GithubSyncService.class)).isEmpty();
        assertThat(applicationContext.getBeanNamesForType(GithubSignatureVerifier.class)).isEmpty();
    }

    /**
     * The table and its migration are unconditional even though the receiver is not -- Flyway
     * does not know about feature flags, and {@code ddl-auto: validate} checks the entity
     * mapping on every boot. Worth pinning: if the flag ever grew to gate the entity too, this
     * would fail rather than surfacing later as a validation error on a machine that happened
     * to have the feature switched on.
     */
    @Test
    void theLedgerTableStillExistsAndIsEmptyOfAnythingThisRunAccepted() {
        Long rowCount = new JdbcTemplate(dataSource)
            .queryForObject("SELECT count(*) FROM github_sync_record", Long.class);

        assertThat(rowCount).isZero();
    }
}
