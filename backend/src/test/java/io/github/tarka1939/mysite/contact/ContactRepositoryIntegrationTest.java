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
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

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
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:17-alpine");

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

        HttpServletRequest otherRequest = requestFrom("198.51.100.7");
        ContactMessageAck ack = contactService.submit(
            new ContactMessageWriteRequest("Bob", "bob@example.com", "Hi from a different IP"), otherRequest);

        assertThat(ack).isNotNull();
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
}
