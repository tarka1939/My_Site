package io.github.tarka1939.mysite.contact;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import io.github.tarka1939.mysite.ClientIpHasher;
import io.github.tarka1939.mysite.RateLimitExceededException;

import jakarta.servlet.http.HttpServletRequest;

@ExtendWith(MockitoExtension.class)
class ContactServiceTest {

    @Mock
    private ContactMessageRepository contactMessageRepository;

    @Mock
    private ClientIpHasher clientIpHasher;

    @Mock
    private HttpServletRequest httpServletRequest;

    private ContactService contactService;

    @BeforeEach
    void setUp() {
        contactService = new ContactService(contactMessageRepository, clientIpHasher);
        when(clientIpHasher.hashOf(httpServletRequest)).thenReturn("hashed-ip");
    }

    @Test
    void submit_underRateLimit_savesMessage() {
        when(contactMessageRepository.countByRequesterIpHashAndCreatedAtAfter(any(), any())).thenReturn(0L);
        ContactMessage saved = new ContactMessage("Alice", "alice@example.com", "Hello", "hashed-ip");
        when(contactMessageRepository.saveAndFlush(any(ContactMessage.class))).thenReturn(saved);

        ContactMessageWriteRequest request = new ContactMessageWriteRequest("Alice", "alice@example.com", "Hello");

        ContactMessageAck ack = contactService.submit(request, httpServletRequest);

        assertThat(ack).isNotNull();
    }

    @Test
    void submit_atRateLimit_throwsRateLimitExceeded() {
        when(contactMessageRepository.countByRequesterIpHashAndCreatedAtAfter(any(), any())).thenReturn(5L);

        ContactMessageWriteRequest request = new ContactMessageWriteRequest("Alice", "alice@example.com", "Hello");

        assertThatThrownBy(() -> contactService.submit(request, httpServletRequest))
            .isInstanceOf(RateLimitExceededException.class);
    }
}
