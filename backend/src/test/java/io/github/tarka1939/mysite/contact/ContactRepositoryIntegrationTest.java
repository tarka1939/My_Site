package io.github.tarka1939.mysite.contact;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.data.domain.PageRequest;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import io.github.tarka1939.mysite.TestPostgres;

import io.github.tarka1939.mysite.PageResponse;
import io.github.tarka1939.mysite.RateLimitExceededException;
import io.github.tarka1939.mysite.ResourceNotFoundException;

import jakarta.servlet.http.HttpServletRequest;

/**
 * The contact service against real Postgres and the real beans behind its rate limit: the
 * {@code ClientIpResolver} the test profile configures for a proxy, and the shared
 * {@code InMemoryRateLimiter} (#309 moved the limit there from a count of stored rows).
 *
 * <p><strong>Every test uses addresses no other test here uses.</strong> {@code @Transactional}
 * rolls each test's rows back, but the limiter is a singleton in the cached context and keeps its
 * buckets, so a test that reused another's address would start with part of its budget spent and
 * pass or fail by execution order.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.NONE)
@Testcontainers
@ActiveProfiles("test")
@Transactional
class ContactRepositoryIntegrationTest {

    @Container
    @ServiceConnection
    static PostgreSQLContainer postgres = TestPostgres.container();

    @Autowired
    private ContactService contactService;

    @Autowired
    private ContactMessageRepository contactMessageRepository;

    @Autowired
    private JdbcClient jdbc;

    @Test
    void submit_underLimit_persistsTheMessageAndNothingDerivedFromTheAddress() {
        HttpServletRequest httpRequest = requestFrom("203.0.113.5");

        ContactMessageAck ack = contactService.submit(
            new ContactMessageWriteRequest("Alice", "alice@example.com", "Hello there"), httpRequest);

        ContactMessage saved = contactMessageRepository.findById(ack.id()).orElseThrow();
        assertThat(saved.getName()).isEqualTo("Alice");
        assertThat(saved.getMessage()).isEqualTo("Hello there");

        // Read back as the raw row rather than through the entity, so a column the entity does not
        // map is still seen. Neither the address nor ClientIpHasher's unsalted -- and so reversible
        // -- hash of it may appear anywhere in it (#309).
        Map<String, Object> row = jdbc.sql("SELECT * FROM contact_message WHERE id = ?")
            .param(ack.id())
            .query()
            .singleRow();
        List<String> values = row.values().stream().map(String::valueOf).toList();
        assertThat(values)
            .noneMatch(value -> value.contains("203.0.113.5"))
            .noneMatch(value -> value.contains(sha256Hex("203.0.113.5")));
    }

    @Test
    void submit_pastLimit_throwsRateLimitExceededAndDoesNotPersist() {
        HttpServletRequest httpRequest = requestFrom("203.0.113.10");
        for (int i = 0; i < 5; i++) {
            contactService.submit(
                new ContactMessageWriteRequest("Alice", "alice@example.com", "Message " + i), httpRequest);
        }

        assertThatThrownBy(() -> contactService.submit(
            new ContactMessageWriteRequest("Alice", "alice@example.com", "One too many"), httpRequest))
            .isInstanceOf(RateLimitExceededException.class);

        assertThat(contactMessageRepository.count()).isEqualTo(5);
    }

    @Test
    void submit_fromDifferentIp_isNotAffectedByAnotherIpsRateLimit() {
        HttpServletRequest httpRequest = requestFrom("203.0.113.20");
        for (int i = 0; i < 5; i++) {
            contactService.submit(
                new ContactMessageWriteRequest("Alice", "alice@example.com", "Message " + i), httpRequest);
        }

        // Not in 198.51.100.0/24, the test profile's trusted-proxy block (issue #168): a plain
        // "some other visitor" case should not sit inside it. Behaviour would be identical either
        // way -- this request carries no forwarded header, so it resolves to its own address
        // regardless -- but a reader should not have to work that out.
        HttpServletRequest otherRequest = requestFrom("203.0.113.21");
        ContactMessageAck ack = contactService.submit(
            new ContactMessageWriteRequest("Bob", "bob@example.com", "Hi from a different IP"), otherRequest);

        assertThat(ack).isNotNull();
    }

    @Test
    void submit_behindATrustedProxy_attributesTheMessageToTheVisitorNamedByXForwardedFor() {
        // Issue #168, and the assertion that catches a proxy misconfiguration later. The header
        // is what the deployed chain (visitor -> Cloudflare -> Mikrus nginx -> app) produces:
        //
        //   203.0.113.99 -- invented by the visitor. Cloudflare APPENDS to an inbound
        //                   X-Forwarded-For rather than replacing it, so a forged value survives
        //                   at the left-hand end. Keying on it would let one sender rotate
        //                   through unlimited buckets.
        //   203.0.113.7  -- the visitor, as Cloudflare saw it. The correct answer.
        //   192.0.2.10   -- the Cloudflare edge node, appended by the Mikrus nginx as its own
        //                   peer. Keying on it would put the whole internet in a handful of
        //                   buckets, which is nearly the bug being fixed.
        //
        // Two trusted proxies in front, each appending the peer it saw, so the visitor is the 2nd
        // entry FROM THE RIGHT -- app.forwarded-headers.trusted-hop-count. From the right, because
        // a caller can only prepend.
        //
        // Nothing about the address is stored since #309, so which bucket a message was charged
        // to is found the only way left: spend a whole budget through the proxy, then ask each
        // candidate address directly. Exactly one of them must find its budget gone.
        HttpServletRequest viaProxy = requestViaProxy("198.51.100.7", "203.0.113.99, 203.0.113.7, 192.0.2.10");
        for (int i = 0; i < 5; i++) {
            contactService.submit(
                new ContactMessageWriteRequest("Carol", "carol@example.com", "Message " + i), viaProxy);
        }

        assertThatThrownBy(() -> contactService.submit(
            new ContactMessageWriteRequest("Carol", "carol@example.com", "Direct"), requestFrom("203.0.113.7")))
            .as("the visitor, counted from the right")
            .isInstanceOf(RateLimitExceededException.class);
        assertThat(submitDirectlyFrom("198.51.100.7"))
            .as("not the proxy's own address -- that is the collapsed bucket #168 is about")
            .isNotNull();
        assertThat(submitDirectlyFrom("203.0.113.99"))
            .as("not the leftmost entry -- the caller controls it")
            .isNotNull();
        assertThat(submitDirectlyFrom("192.0.2.10"))
            .as("not the rightmost entry -- that is the Cloudflare edge node")
            .isNotNull();
    }

    @Test
    void submit_behindATrustedProxy_ratesLimitPerVisitorNotPerProxy() {
        HttpServletRequest firstVisitor = requestViaProxy("198.51.100.7", "203.0.113.50, 192.0.2.10");
        for (int i = 0; i < 5; i++) {
            contactService.submit(
                new ContactMessageWriteRequest("Dave", "dave@example.com", "Message " + i), firstVisitor);
        }
        assertThatThrownBy(() -> contactService.submit(
            new ContactMessageWriteRequest("Dave", "dave@example.com", "One too many"), firstVisitor))
            .isInstanceOf(RateLimitExceededException.class);

        // Same proxy, different visitor: an untouched budget. Without #168's fix this second
        // visitor would already be silenced by the first one's five messages.
        HttpServletRequest secondVisitor = requestViaProxy("198.51.100.7", "203.0.113.51, 192.0.2.10");
        ContactMessageAck ack = contactService.submit(
            new ContactMessageWriteRequest("Erin", "erin@example.com", "Hi"), secondVisitor);

        assertThat(ack).isNotNull();
    }

    @Test
    void submit_forwardedHeaderFromAnUntrustedPeer_isIgnored() {
        // 203.0.113.60 is not in the trusted-proxy block, so it is someone reaching the app
        // directly. Every attempt claims a different visitor; if the header were believed, each
        // would get its own bucket and the limiter would be defeated entirely rather than merely
        // globalised -- the failure mode that makes unconditional trust worse than the bug.
        for (int i = 0; i < 5; i++) {
            HttpServletRequest forged = requestViaProxy("203.0.113.60", "192.0.2." + (20 + i) + ", 192.0.2.10");
            contactService.submit(
                new ContactMessageWriteRequest("Frank", "frank@example.com", "Message " + i), forged);
        }

        HttpServletRequest forged = requestViaProxy("203.0.113.60", "192.0.2.99, 192.0.2.10");
        assertThatThrownBy(() -> contactService.submit(
            new ContactMessageWriteRequest("Frank", "frank@example.com", "One too many"), forged))
            .isInstanceOf(RateLimitExceededException.class);

        assertThatThrownBy(() -> contactService.submit(
            new ContactMessageWriteRequest("Frank", "frank@example.com", "Plain"), requestFrom("203.0.113.60")))
            .as("attributed to the peer's own address, not to anything it claimed")
            .isInstanceOf(RateLimitExceededException.class);
        assertThat(submitDirectlyFrom("192.0.2.20"))
            .as("and an address it claimed was never charged")
            .isNotNull();
    }

    @Test
    void listMessages_returnsPaginatedAdminView() {
        HttpServletRequest httpRequest = requestFrom("203.0.113.30");
        for (int i = 0; i < 3; i++) {
            contactService.submit(new ContactMessageWriteRequest("Name " + i, "n" + i + "@example.com", "Msg"), httpRequest);
        }

        PageResponse<ContactMessageResponse> page = contactService.listMessages(PageRequest.of(0, 2));

        assertThat(page.totalElements()).isEqualTo(3);
        assertThat(page.content()).hasSize(2);
    }

    @Test
    void deleteMessage_whenMissing_throwsResourceNotFoundException() {
        assertThatThrownBy(() -> contactService.deleteMessage(UUID.randomUUID()))
            .isInstanceOf(ResourceNotFoundException.class);
    }

    private ContactMessageAck submitDirectlyFrom(String remoteAddr) {
        return contactService.submit(
            new ContactMessageWriteRequest("Probe", "probe@example.com", "Which bucket?"), requestFrom(remoteAddr));
    }

    private HttpServletRequest requestFrom(String remoteAddr) {
        HttpServletRequest request = mock(HttpServletRequest.class);
        when(request.getRemoteAddr()).thenReturn(remoteAddr);
        return request;
    }

    /**
     * A request whose TCP peer is {@code peerAddress} and which carries {@code forwardedFor} as
     * its {@code X-Forwarded-For}. Whether that header is believed depends entirely on the peer,
     * which is the point of the tests that use it.
     */
    private HttpServletRequest requestViaProxy(String peerAddress, String forwardedFor) {
        HttpServletRequest request = mock(HttpServletRequest.class);
        when(request.getRemoteAddr()).thenReturn(peerAddress);
        // Answered fresh per call, not with one fixed Enumeration: an Enumeration is consumed by
        // reading it, and these requests are submitted repeatedly to exhaust a rate-limit budget.
        when(request.getHeaders("X-Forwarded-For"))
            .thenAnswer(invocation -> java.util.Collections.enumeration(java.util.List.of(forwardedFor)));
        return request;
    }

    private static String sha256Hex(String value) {
        try {
            var digest = java.security.MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(value.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            return java.util.HexFormat.of().formatHex(hash);
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
