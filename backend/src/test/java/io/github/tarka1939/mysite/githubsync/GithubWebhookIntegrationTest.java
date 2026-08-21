package io.github.tarka1939.mysite.githubsync;

import static io.github.tarka1939.mysite.githubsync.GithubWebhookTestSupport.SECRET;
import static io.github.tarka1939.mysite.githubsync.GithubWebhookTestSupport.headers;
import static io.github.tarka1939.mysite.githubsync.GithubWebhookTestSupport.nonThrowingRestTemplate;
import static io.github.tarka1939.mysite.githubsync.GithubWebhookTestSupport.payload;
import static io.github.tarka1939.mysite.githubsync.GithubWebhookTestSupport.sign;
import static org.assertj.core.api.Assertions.assertThat;

import java.nio.charset.StandardCharsets;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.web.client.RestTemplate;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

/**
 * The receiver end to end: real HTTP, the real Spring Security filter chain, a real Postgres.
 *
 * <p>The flag is switched on here by test properties rather than in {@code application-test.yml},
 * so that each test class states the flag position it is exercising -- this one on,
 * {@code GithubWebhookDisabledIntegrationTest} off. A shared default would make the polarity
 * invisible at the point where it matters.
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
class GithubWebhookIntegrationTest {

    @Container
    @ServiceConnection
    static PostgreSQLContainer postgres = new PostgreSQLContainer("postgres:17-alpine");

    @LocalServerPort
    private int port;

    @Autowired
    private GithubSyncRecordRepository repository;

    @Autowired
    private GithubWebhookTestSupport.RecordingListener recordingListener;

    private final RestTemplate restTemplate = nonThrowingRestTemplate();

    @BeforeEach
    void resetRecordedEvents() {
        recordingListener.clear();
    }

    private String url() {
        return "http://localhost:" + port + "/api/v1/webhooks/github";
    }

    private ResponseEntity<String> post(byte[] body, HttpHeaders headers) {
        return restTemplate.postForEntity(url(), new HttpEntity<>(body, headers), String.class);
    }

    private static String uniqueDeliveryId() {
        return UUID.randomUUID().toString();
    }

    @Test
    void acceptsACorrectlySignedDelivery() {
        byte[] body = payload("{\"repository\":{\"full_name\":\"tarka1939/My_Site\"},\"ref\":\"refs/heads/main\"}");
        String deliveryId = uniqueDeliveryId();

        ResponseEntity<String> response = post(body, headers(sign(body), deliveryId, "push"));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.ACCEPTED);
        // The literal wire form, not the enum -- docs/openapi.yaml spells these lowercase and a
        // Java enum would serialise as RECORDED without the @JsonValue that makes it not.
        assertThat(response.getBody()).contains("\"status\":\"recorded\"");
        assertThat(response.getBody()).contains("\"deliveryId\":\"" + deliveryId + "\"");

        var stored = repository.findByGithubDeliveryId(deliveryId);
        assertThat(stored).isPresent();
        assertThat(stored.get().getEventType()).isEqualTo("push");
        assertThat(stored.get().getRepoFullName()).isEqualTo("tarka1939/My_Site");
        assertThat(stored.get().getReceivedAt()).isNotNull();
        assertThat(stored.get().getRawPayload()).contains("refs/heads/main");

        assertThat(recordingListener.events()).hasSize(1);
        assertThat(recordingListener.events().getFirst().deliveryId()).isEqualTo(deliveryId);
        assertThat(recordingListener.events().getFirst().recordId()).isEqualTo(stored.get().getId());
    }

    /**
     * The raw-body guarantee, asserted through the whole stack rather than against the verifier
     * in isolation. This body is formatted the way no serialiser emits -- newlines, tabs, keys
     * out of order, a unicode escape -- so if anything between the socket and the verifier had
     * parsed and re-emitted it, the bytes would differ from the signed ones and this would be a
     * 401 rather than a 202.
     *
     * <p>The second half is the sharper evidence, and it was a surprise worth writing down:
     * what Postgres stored is NOT what was sent. jsonb is a parsed representation rather than a
     * string, so it strips whitespace, reorders keys, and resolves the unicode escape to the
     * character it denotes. The stored form is therefore exactly the kind of re-serialisation
     * that would fail verification -- and the request verified anyway. That can only hold if
     * the signature was checked against the bytes off the wire, and nothing derived from them.
     */
    @Test
    void verifiesAgainstTheBytesOnTheWire_notAReserialisedForm() {
        byte[] body = payload("{\n  \"zeta\":\t1,\n"
            + "    \"repository\" :  { \"full_name\" : \"tarka1939/My_Site\" }  ,\n"
            + "\"alpha\":\"tr\\u00e4iling \"\n}\n");
        String deliveryId = uniqueDeliveryId();

        ResponseEntity<String> response = post(body, headers(sign(body), deliveryId, "push"));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.ACCEPTED);

        String stored = repository.findByGithubDeliveryId(deliveryId).orElseThrow().getRawPayload();
        assertThat(stored)
            .as("jsonb keeps the content")
            .contains("tarka1939/My_Site")
            .contains("träiling ");
        assertThat(stored)
            .as("but demonstrably not the formatting -- which is why verification cannot use it")
            .isNotEqualTo(new String(body, StandardCharsets.UTF_8));
    }

    @Test
    void rejectsAWrongSignature() {
        byte[] body = payload("{\"repository\":{\"full_name\":\"attacker/repo\"}}");
        String deliveryId = uniqueDeliveryId();
        String wrongSignature = sign("a-different-and-equally-long-secret", body);

        ResponseEntity<String> response = post(body, headers(wrongSignature, deliveryId, "push"));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThat(repository.findByGithubDeliveryId(deliveryId)).isEmpty();
        assertThat(recordingListener.events()).isEmpty();
    }

    @Test
    void rejectsASignatureThatIsValidForADifferentBody() {
        byte[] signedBody = payload("{\"repository\":{\"full_name\":\"tarka1939/My_Site\"}}");
        byte[] sentBody = payload("{\"repository\":{\"full_name\":\"attacker/backdoor\"}}");
        String deliveryId = uniqueDeliveryId();

        ResponseEntity<String> response = post(sentBody, headers(sign(signedBody), deliveryId, "push"));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThat(repository.findByGithubDeliveryId(deliveryId)).isEmpty();
    }

    @Test
    void rejectsAMissingSignatureHeader() {
        byte[] body = payload("{\"repository\":{\"full_name\":\"attacker/repo\"}}");
        String deliveryId = uniqueDeliveryId();

        ResponseEntity<String> response = post(body, headers(null, deliveryId, "push"));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThat(repository.findByGithubDeliveryId(deliveryId)).isEmpty();
        assertThat(recordingListener.events()).isEmpty();
    }

    /**
     * Accepting the legacy SHA-1 header when the SHA-256 one is absent would be a downgrade
     * that an attacker gets to choose. GitHub sends both; this receiver reads only one.
     */
    @Test
    void doesNotFallBackToTheLegacySha1Header() {
        byte[] body = payload("{\"repository\":{\"full_name\":\"attacker/repo\"}}");
        String deliveryId = uniqueDeliveryId();
        HttpHeaders withOnlySha1 = headers(null, deliveryId, "push");
        withOnlySha1.set("X-Hub-Signature", "sha1=0000000000000000000000000000000000000000");

        assertThat(post(body, withOnlySha1).getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThat(repository.findByGithubDeliveryId(deliveryId)).isEmpty();
    }

    /**
     * The response must not tell an unauthenticated prober which part of the check failed.
     */
    @Test
    void saysNothingAboutWhyTheSignatureFailed() {
        byte[] body = payload("{}");

        String noHeader = post(body, headers(null, uniqueDeliveryId(), "push")).getBody();
        String wrongSecret = post(body, headers(
            sign("a-different-and-equally-long-secret", body), uniqueDeliveryId(), "push")).getBody();
        String malformed = post(body, headers("sha256=nonsense", uniqueDeliveryId(), "push")).getBody();

        assertThat(noHeader).isEqualTo(wrongSecret).isEqualTo(malformed);
    }

    @Test
    void rejectsAVerifiedDeliveryMissingTheDeliveryIdHeader() {
        byte[] body = payload("{\"repository\":{\"full_name\":\"tarka1939/My_Site\"}}");

        ResponseEntity<String> response = post(body, headers(sign(body), null, "push"));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(response.getBody()).contains(GithubWebhookController.DELIVERY_HEADER);
        assertThat(recordingListener.events()).isEmpty();
    }

    @Test
    void rejectsAVerifiedDeliveryMissingTheEventTypeHeader() {
        byte[] body = payload("{\"repository\":{\"full_name\":\"tarka1939/My_Site\"}}");
        String deliveryId = uniqueDeliveryId();

        ResponseEntity<String> response = post(body, headers(sign(body), deliveryId, null));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(repository.findByGithubDeliveryId(deliveryId)).isEmpty();
    }

    /**
     * A missing header is a 401, not a 400, when the signature is also absent -- the ordering in
     * the controller is deliberate and this pins it. An unsigned caller learns nothing about
     * which headers this endpoint wants.
     */
    @Test
    void checksTheSignatureBeforeTheRequiredHeaders() {
        byte[] body = payload("{}");

        ResponseEntity<String> response = post(body, headers(null, null, null));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    @Test
    void rejectsAVerifiedBodyThatIsNotJson() {
        byte[] body = payload("this is not json");
        String deliveryId = uniqueDeliveryId();

        ResponseEntity<String> response = post(body, headers(sign(body), deliveryId, "push"));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(repository.findByGithubDeliveryId(deliveryId)).isEmpty();
    }

    @Test
    void rejectsAnOverlongDeliveryIdRatherThanOverflowingTheColumn() {
        byte[] body = payload("{}");
        String overlong = "d".repeat(GithubWebhookController.MAX_DELIVERY_ID_LENGTH + 1);

        ResponseEntity<String> response = post(body, headers(sign(body), overlong, "push"));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(repository.findByGithubDeliveryId(overlong)).isEmpty();
    }

    @Test
    void rejectsAFormEncodedDeliveryInsteadOfRecordingItAsGarbage() {
        byte[] body = payload("payload=%7B%22zen%22%3A%22nope%22%7D");
        HttpHeaders formHeaders = headers(sign(body), uniqueDeliveryId(), "push");
        formHeaders.setContentType(MediaType.APPLICATION_FORM_URLENCODED);

        ResponseEntity<String> response = post(body, formHeaders);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNSUPPORTED_MEDIA_TYPE);
    }

    /**
     * The endpoint is unauthenticated, so the body has to be read before the sender is known --
     * which means the size cap cannot wait for verification. Note this asserts 413 for a body
     * that is <i>correctly signed</i>: the cap is not a signature check in disguise.
     */
    @Test
    void rejectsAPayloadOverTheSizeCap() {
        byte[] oversized =
            payload("{\"pad\":\"" + "x".repeat(GithubWebhookController.MAX_PAYLOAD_BYTES) + "\"}");
        String deliveryId = uniqueDeliveryId();

        ResponseEntity<String> response = post(oversized, headers(sign(oversized), deliveryId, "push"));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CONTENT_TOO_LARGE);
        assertThat(repository.findByGithubDeliveryId(deliveryId)).isEmpty();
        assertThat(recordingListener.events()).isEmpty();
    }

    @Test
    void acceptsAPayloadJustUnderTheSizeCap() {
        String pad = "x".repeat(GithubWebhookController.MAX_PAYLOAD_BYTES - "{\"pad\":\"\"}".length());
        byte[] atCap = payload("{\"pad\":\"" + pad + "\"}");
        assertThat(atCap).hasSize(GithubWebhookController.MAX_PAYLOAD_BYTES);
        String deliveryId = uniqueDeliveryId();

        ResponseEntity<String> response = post(atCap, headers(sign(atCap), deliveryId, "push"));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.ACCEPTED);
    }

    /**
     * An organization-level ping names no repository. Recording it is the point -- see
     * {@code GithubSyncServiceTest} for why refusing would put a hole in idempotency.
     */
    @Test
    void recordsAPingThatNamesNoRepository() {
        byte[] body = payload("{\"zen\":\"Keep it logically awesome.\",\"hook_id\":42}");
        String deliveryId = uniqueDeliveryId();

        ResponseEntity<String> response = post(body, headers(sign(body), deliveryId, "ping"));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.ACCEPTED);
        assertThat(repository.findByGithubDeliveryId(deliveryId))
            .get()
            .extracting(GithubSyncRecord::getRepoFullName)
            .isNull();
        assertThat(recordingListener.events()).hasSize(1);
        assertThat(recordingListener.events().getFirst().repoFullName()).isNull();
    }

    /**
     * Reachable with no bearer token, because SecurityConfig names this exact path -- and the
     * proof is that a *bad signature* gets 401 from the application's own handler while a good
     * one gets 202. If the filter chain were rejecting these, both would be 401 and the test
     * above would pass for the wrong reason.
     */
    @Test
    void needsNoBearerTokenToReachTheHandler() {
        byte[] body = payload("{}");
        String deliveryId = uniqueDeliveryId();
        HttpHeaders noAuth = headers(sign(body), deliveryId, "push");
        assertThat(noAuth.get(HttpHeaders.AUTHORIZATION)).isNull();

        assertThat(post(body, noAuth).getStatusCode()).isEqualTo(HttpStatus.ACCEPTED);
    }
}
