package io.github.tarka1939.mysite.githubsync;

import java.nio.charset.StandardCharsets;
import java.util.HexFormat;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.event.EventListener;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.web.client.DefaultResponseErrorHandler;
import org.springframework.web.client.RestTemplate;

/**
 * Shared pieces for the webhook integration tests.
 *
 * <p>Requests are built from {@code byte[]} and sent with an explicit content type, rather than
 * from a Map or a DTO, because the test has to control the exact bytes on the wire -- signing
 * one representation and letting a converter send a different one is precisely the bug these
 * tests exist to rule out.
 */
final class GithubWebhookTestSupport {

    /** Long enough for {@link GithubSignatureVerifier}'s floor. */
    static final String SECRET = "integration-test-github-webhook-secret";

    private GithubWebhookTestSupport() {
    }

    static byte[] payload(String json) {
        return json.getBytes(StandardCharsets.UTF_8);
    }

    static String sign(byte[] body) {
        return sign(SECRET, body);
    }

    static String sign(String secret, byte[] body) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            return "sha256=" + HexFormat.of().formatHex(mac.doFinal(body));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    static HttpHeaders headers(String signature, String deliveryId, String eventType) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        if (signature != null) {
            headers.set(GithubWebhookController.SIGNATURE_HEADER, signature);
        }
        if (deliveryId != null) {
            headers.set(GithubWebhookController.DELIVERY_HEADER, deliveryId);
        }
        if (eventType != null) {
            headers.set(GithubWebhookController.EVENT_HEADER, eventType);
        }
        return headers;
    }

    /**
     * Never throws on 4xx/5xx, so a test can assert on the status it got. Same approach and
     * reasoning as {@code SecurityIntegrationTest} -- see the note there about
     * {@code TestRestTemplate} not being resolvable in this Boot 4.1.0 setup.
     */
    static RestTemplate nonThrowingRestTemplate() {
        RestTemplate template = new RestTemplate(new SimpleClientHttpRequestFactory());
        template.setErrorHandler(new DefaultResponseErrorHandler() {
            @Override
            public boolean hasError(org.springframework.http.client.ClientHttpResponse response) {
                return false;
            }
        });
        return template;
    }

    /**
     * Counts {@link GithubDeliveryReceivedEvent}s. A plain listener bean rather than Spring's
     * {@code @RecordApplicationEvents}: that records events on the test's own thread, and these
     * are published on whatever container thread the request landed on, so it would report
     * nothing.
     */
    static class RecordingListener {

        private final List<GithubDeliveryReceivedEvent> events = new CopyOnWriteArrayList<>();

        @EventListener
        void onDeliveryReceived(GithubDeliveryReceivedEvent event) {
            events.add(event);
        }

        List<GithubDeliveryReceivedEvent> events() {
            return List.copyOf(events);
        }

        void clear() {
            events.clear();
        }
    }

    @TestConfiguration
    static class RecordingListenerConfiguration {

        @Bean
        RecordingListener recordingListener() {
            return new RecordingListener();
        }
    }
}
