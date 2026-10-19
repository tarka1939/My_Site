package io.github.tarka1939.mysite.contact;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.test.util.ReflectionTestUtils;

import io.github.tarka1939.mysite.ClientIpHasher;
import io.github.tarka1939.mysite.InMemoryRateLimiter;
import io.github.tarka1939.mysite.RateLimitExceededException;

import jakarta.servlet.http.HttpServletRequest;

@ExtendWith(MockitoExtension.class)
class ContactServiceTest {

    @Mock
    private ContactMessageRepository contactMessageRepository;

    @Mock
    private ClientIpHasher clientIpHasher;

    @Mock
    private InMemoryRateLimiter rateLimiter;

    @Mock
    private ApplicationEventPublisher eventPublisher;

    @Mock
    private HttpServletRequest httpServletRequest;

    private ContactService contactService;

    @BeforeEach
    void setUp() {
        contactService = new ContactService(contactMessageRepository, clientIpHasher, rateLimiter, eventPublisher);
        when(clientIpHasher.hashOf(httpServletRequest)).thenReturn("hashed-ip");
    }

    @Test
    void submit_underRateLimit_savesMessage() {
        when(rateLimiter.tryAcquire(anyString(), anyInt(), any())).thenReturn(true);
        when(contactMessageRepository.saveAndFlush(any(ContactMessage.class)))
            .thenReturn(persisted("Alice", "alice@example.com", "Hello"));

        ContactMessageWriteRequest request = new ContactMessageWriteRequest("Alice", "alice@example.com", "Hello");

        ContactMessageAck ack = contactService.submit(request, httpServletRequest);

        assertThat(ack).isNotNull();
    }

    @Test
    void submit_asksTheLimiterForFivePerHourUnderItsOwnNamespace() {
        when(rateLimiter.tryAcquire(anyString(), anyInt(), any())).thenReturn(true);
        when(contactMessageRepository.saveAndFlush(any(ContactMessage.class)))
            .thenReturn(persisted("Alice", "alice@example.com", "Hello"));

        contactService.submit(
            new ContactMessageWriteRequest("Alice", "alice@example.com", "Hello"), httpServletRequest);

        // The numbers are the ones the row count enforced before #309, unchanged. The prefix is
        // what keeps this budget apart from the same IP's "login:" and "password-reset:" ones in
        // the shared limiter; ContactRateLimitIntegrationTest checks that against the real beans.
        verify(rateLimiter).tryAcquire("contact:hashed-ip", 5, Duration.ofHours(1));
    }

    @Test
    void submit_underRateLimit_publishesReceivedEventCarryingTheSubmission() {
        when(rateLimiter.tryAcquire(anyString(), anyInt(), any())).thenReturn(true);
        ContactMessage saved = persisted("Alice", "alice@example.com", "Hello");
        when(contactMessageRepository.saveAndFlush(any(ContactMessage.class))).thenReturn(saved);

        contactService.submit(
            new ContactMessageWriteRequest("Alice", "alice@example.com", "Hello"), httpServletRequest);

        ArgumentCaptor<ContactMessageReceivedEvent> captor =
            ArgumentCaptor.forClass(ContactMessageReceivedEvent.class);
        verify(eventPublisher).publishEvent(captor.capture());

        // The event carries the submission rather than only the id, so the listener never has to
        // re-read a row the admin may have deleted in the meantime -- see the event's javadoc.
        assertThat(captor.getValue()).isEqualTo(new ContactMessageReceivedEvent(
            saved.getId(), saved.getCreatedAt(), "Alice", "alice@example.com", "Hello"));
    }

    @Test
    void submit_atRateLimit_throwsRateLimitExceededAndSavesNothing() {
        when(rateLimiter.tryAcquire(eq("contact:hashed-ip"), anyInt(), any())).thenReturn(false);

        ContactMessageWriteRequest request = new ContactMessageWriteRequest("Alice", "alice@example.com", "Hello");

        assertThatThrownBy(() -> contactService.submit(request, httpServletRequest))
            .isInstanceOf(RateLimitExceededException.class)
            .hasMessage("Too many contact messages from this requester");
        verify(contactMessageRepository, never()).saveAndFlush(any());
    }

    @Test
    void submit_atRateLimit_publishesNothing() {
        when(rateLimiter.tryAcquire(anyString(), anyInt(), any())).thenReturn(false);

        assertThatThrownBy(() -> contactService.submit(
            new ContactMessageWriteRequest("Alice", "alice@example.com", "Hello"), httpServletRequest))
            .isInstanceOf(RateLimitExceededException.class);

        // A rejected submission is not a received message: notifying on one would turn the rate
        // limiter from an abuse guard into an amplifier pointed at the owner's inbox.
        verify(eventPublisher, never()).publishEvent(any(Object.class));
    }

    /**
     * Stands in for a row that has been through {@code saveAndFlush}: the id and the
     * {@code @CreationTimestamp} are database-assigned and null on a freshly constructed entity,
     * but the event copies both.
     */
    private static ContactMessage persisted(String name, String email, String body) {
        ContactMessage message = new ContactMessage(name, email, body);
        ReflectionTestUtils.setField(message, "id", UUID.randomUUID());
        ReflectionTestUtils.setField(message, "createdAt", Instant.parse("2026-09-03T10:15:30Z"));
        return message;
    }
}
