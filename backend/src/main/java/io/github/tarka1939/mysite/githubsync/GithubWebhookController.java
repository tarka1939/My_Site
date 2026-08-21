package io.github.tarka1939.mysite.githubsync;

import java.io.IOException;

import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseBody;

import io.github.tarka1939.mysite.InvalidWebhookSignatureException;
import io.github.tarka1939.mysite.MalformedWebhookPayloadException;
import io.github.tarka1939.mysite.WebhookPayloadTooLargeException;

import jakarta.servlet.http.HttpServletRequest;

/**
 * Receives GitHub webhook deliveries. Only exists when {@code app.github-sync.enabled} is true
 * -- see {@link GithubSyncConfiguration}, which is the single place that decision is made.
 *
 * <p>This is the one endpoint on this API that a stranger can reach with no bearer token, so
 * the order of operations below is the security design and not an implementation detail.
 *
 * <p>{@code @RequestMapping} + {@code @ResponseBody} rather than {@code @RestController}: that
 * shorthand is those two plus {@code @Controller}, which is a {@code @Component}, which would
 * mean component scan registering this class unconditionally <i>and</i>
 * {@link GithubSyncConfiguration} registering it again -- a duplicate bean definition, which
 * Boot rejects at startup. Dropping the stereotype leaves the flag as the only thing that
 * decides whether this handler exists. {@code RequestMappingHandlerMapping} treats any bean
 * whose type carries {@code @Controller} <i>or</i> {@code @RequestMapping} as a handler, so the
 * mapping is unaffected -- and both halves of that are asserted, 202 when the flag is on in
 * {@code GithubWebhookIntegrationTest} and 404 when it is off in
 * {@code GithubWebhookDisabledIntegrationTest}, rather than left as a claim about Spring
 * internals.
 */
@RequestMapping("/api/v1/webhooks/github")
@ResponseBody
public class GithubWebhookController {

    /**
     * 1 MiB. GitHub caps its own deliveries at 25 MB, and a real push payload is tens of KB
     * (the {@code commits} array is truncated at 20 entries), so this is generous for anything
     * legitimate. It exists because the alternative on an unauthenticated endpoint is letting
     * any stranger decide how much heap to allocate: the body has to be read before the sender
     * can be identified, so "verify first, then bound the read" is not available.
     */
    static final int MAX_PAYLOAD_BYTES = 1024 * 1024;

    static final String SIGNATURE_HEADER = "X-Hub-Signature-256";
    static final String DELIVERY_HEADER = "X-GitHub-Delivery";
    static final String EVENT_HEADER = "X-GitHub-Event";

    /** Matches {@code github_sync_record.github_delivery_id}; GitHub sends a 36-char UUID. */
    static final int MAX_DELIVERY_ID_LENGTH = 255;

    /** Matches {@code github_sync_record.event_type}; GitHub's longest event name is ~30. */
    static final int MAX_EVENT_TYPE_LENGTH = 100;

    private final GithubSignatureVerifier signatureVerifier;
    private final GithubSyncService githubSyncService;

    GithubWebhookController(GithubSignatureVerifier signatureVerifier, GithubSyncService githubSyncService) {
        this.signatureVerifier = signatureVerifier;
        this.githubSyncService = githubSyncService;
    }

    /**
     * {@code consumes} is a mapping condition, evaluated before this method is entered, so a
     * webhook misconfigured to send {@code application/x-www-form-urlencoded} gets a 415 from
     * Spring rather than having {@code payload=%7B...} recorded as if it were a body. It costs
     * nothing and does not interfere with reading the raw bytes below, because it constrains
     * the mapping rather than the argument resolution.
     *
     * <p>Every header is {@code required = false} and checked by hand further down. Letting
     * Spring enforce {@code required = true} would be less code, but argument resolution runs
     * before the method body -- a request missing {@code X-GitHub-Delivery} would then be
     * answered before its signature was ever looked at. The ordering below is the point of
     * doing it manually, so it is worth the extra lines.
     */
    @PostMapping(consumes = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<GithubWebhookAck> receiveGithubWebhook(
        @RequestHeader(value = SIGNATURE_HEADER, required = false) String signature,
        @RequestHeader(value = DELIVERY_HEADER, required = false) String deliveryId,
        @RequestHeader(value = EVENT_HEADER, required = false) String eventType,
        HttpServletRequest request
    ) throws IOException {

        // 1. The raw bytes, straight off the servlet input stream.
        //
        // This is the whole raw-body problem, solved by not creating it. GitHub HMACs the exact
        // octets it sent; anything that has been through a message converter and back is a
        // different byte sequence (key order, whitespace, escaping) and will not verify. Taking
        // `@RequestBody byte[]` would also work today -- ByteArrayHttpMessageConverter sits
        // ahead of Jackson in the default chain -- but that is a fact about converter ordering
        // that a later dependency bump could quietly change, and the failure would look like a
        // signature mismatch rather than like a regression. Reading the stream directly leaves
        // no converter in the path to reason about.
        byte[] rawBody = readBoundedBody(request);

        // 2. Verify, before anything at all is trusted -- before parsing, before the headers
        //    below are so much as validated. Nothing that follows runs for a stranger.
        if (!signatureVerifier.isValid(rawBody, signature)) {
            throw new InvalidWebhookSignatureException();
        }

        // 3. Only now: the caller has proved it holds the shared secret.
        requirePlausibleHeader(deliveryId, DELIVERY_HEADER, MAX_DELIVERY_ID_LENGTH);
        requirePlausibleHeader(eventType, EVENT_HEADER, MAX_EVENT_TYPE_LENGTH);

        GithubWebhookAck ack = githubSyncService.accept(deliveryId, eventType, rawBody);

        // 202 rather than 201: what has happened is that the delivery was accepted and
        // announced. Whether anything acts on it is issue #54's question and, right now, the
        // answer is no -- see GithubDeliveryReceivedEvent. Claiming 201 Created would be
        // describing the ledger row as if it were the point.
        return ResponseEntity.status(HttpStatus.ACCEPTED).body(ack);
    }

    /**
     * Reads at most one byte more than the cap, so "too big" is detectable without having read
     * the whole thing. The stream is not closed here -- the container owns it.
     */
    private static byte[] readBoundedBody(HttpServletRequest request) throws IOException {
        byte[] body = request.getInputStream().readNBytes(MAX_PAYLOAD_BYTES + 1);
        if (body.length > MAX_PAYLOAD_BYTES) {
            throw new WebhookPayloadTooLargeException(
                "Webhook payload exceeds " + MAX_PAYLOAD_BYTES + " bytes");
        }
        return body;
    }

    /**
     * Length is checked rather than trusted. The values land in bounded columns, and an
     * over-long one would otherwise surface as a 500 from the insert -- which GitHub would
     * retry on a schedule, forever, for a request that can never succeed. A 400 says so once.
     */
    private static void requirePlausibleHeader(String value, String headerName, int maxLength) {
        if (value == null || value.isBlank()) {
            throw new MalformedWebhookPayloadException("Missing required header " + headerName);
        }
        if (value.length() > maxLength) {
            throw new MalformedWebhookPayloadException(
                headerName + " exceeds " + maxLength + " characters");
        }
    }
}
