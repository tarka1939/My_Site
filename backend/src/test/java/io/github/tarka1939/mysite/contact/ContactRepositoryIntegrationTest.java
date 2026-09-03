package io.github.tarka1939.mysite.contact;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.data.domain.PageRequest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

import io.github.tarka1939.mysite.PageResponse;
import io.github.tarka1939.mysite.RateLimitExceededException;
import io.github.tarka1939.mysite.ResourceNotFoundException;

import jakarta.servlet.http.HttpServletRequest;

/**
 * Rate limiting depends on a real timestamp comparison against Postgres (count(*) where
 * created_at > now() - interval) -- worth verifying against real Postgres rather than only
 * mocking the repository count, per the Phase 1 AGENT_LOG.md lesson about infra-dependent
 * behavior mocks can't catch.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.NONE)
@Testcontainers
@ActiveProfiles("test")
@Transactional
class ContactRepositoryIntegrationTest {

    @Container
    @ServiceConnection
    static PostgreSQLContainer postgres = new PostgreSQLContainer("postgres:17-alpine");

    @Autowired
    private ContactService contactService;

    @Autowired
    private ContactMessageRepository contactMessageRepository;

    @Test
    void submit_underLimit_persistsMessageWithHashedIpNotRawIp() {
        HttpServletRequest httpRequest = requestFrom("203.0.113.5");

        ContactMessageAck ack = contactService.submit(
            new ContactMessageWriteRequest("Alice", "alice@example.com", "Hello there"), httpRequest);

        ContactMessage saved = contactMessageRepository.findById(ack.id()).orElseThrow();
        assertThat(saved.getRequesterIpHash()).isNotEqualTo("203.0.113.5");
        assertThat(saved.getRequesterIpHash()).hasSize(64); // sha-256 hex digest length
    }

    @Test
    void submit_pastLimit_throwsRateLimitExceededAndDoesNotPersist() {
        HttpServletRequest httpRequest = requestFrom("203.0.113.5");
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
        HttpServletRequest httpRequest = requestFrom("203.0.113.5");
        for (int i = 0; i < 5; i++) {
            contactService.submit(
                new ContactMessageWriteRequest("Alice", "alice@example.com", "Message " + i), httpRequest);
        }

        // 203.0.113.6, not the 198.51.100.7 this used to use: the test profile now names
        // 198.51.100.0/24 as the trusted-proxy block (issue #168), and a plain "some other
        // visitor" case should not sit inside it. Behaviour is identical either way -- this
        // request carries no forwarded header, so it resolves to its own address regardless --
        // but a reader should not have to work that out.
        HttpServletRequest otherRequest = requestFrom("203.0.113.6");
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
        HttpServletRequest viaProxy = requestViaProxy("198.51.100.7", "203.0.113.99, 203.0.113.7, 192.0.2.10");

        ContactMessageAck ack = contactService.submit(
            new ContactMessageWriteRequest("Carol", "carol@example.com", "Hello from behind a proxy"), viaProxy);

        ContactMessage saved = contactMessageRepository.findById(ack.id()).orElseThrow();
        assertThat(saved.getRequesterIpHash())
            .as("the visitor, counted from the right")
            .isEqualTo(sha256Hex("203.0.113.7"));
        assertThat(saved.getRequesterIpHash())
            .as("not the proxy's own address -- that is the collapsed bucket #168 is about")
            .isNotEqualTo(sha256Hex("198.51.100.7"));
        assertThat(saved.getRequesterIpHash())
            .as("not the leftmost entry -- the caller controls it")
            .isNotEqualTo(sha256Hex("203.0.113.99"));
        assertThat(saved.getRequesterIpHash())
            .as("not the rightmost entry -- that is the Cloudflare edge node")
            .isNotEqualTo(sha256Hex("192.0.2.10"));
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

        ContactMessage saved = contactMessageRepository.findAll().get(0);
        assertThat(saved.getRequesterIpHash())
            .as("attributed to the peer's own address, not to anything it claimed")
            .isEqualTo(sha256Hex("203.0.113.60"));
    }

    @Test
    void listMessages_returnsPaginatedAdminView() {
        HttpServletRequest httpRequest = requestFrom("203.0.113.5");
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
