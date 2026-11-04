package io.github.tarka1939.mysite.contact;

import java.time.Duration;
import java.util.UUID;

import org.springframework.context.ApplicationEventPublisher;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import io.github.tarka1939.mysite.ClientIpHasher;
import io.github.tarka1939.mysite.InMemoryRateLimiter;
import io.github.tarka1939.mysite.PageResponse;
import io.github.tarka1939.mysite.RateLimitExceededException;
import io.github.tarka1939.mysite.ResourceNotFoundException;

import jakarta.servlet.http.HttpServletRequest;

@Service
public class ContactService {

    // Basic abuse guard -- 5 messages/hour/IP is a deliberately generous default for a
    // low-traffic portfolio contact form. The window is the same hour password-reset-request
    // uses, so this caller does not widen InMemoryRateLimiter's observed longest window.
    private static final int MAX_MESSAGES_PER_WINDOW = 5;
    private static final Duration RATE_LIMIT_WINDOW = Duration.ofHours(1);

    private final ContactMessageRepository contactMessageRepository;
    private final ClientIpHasher clientIpHasher;
    private final InMemoryRateLimiter rateLimiter;
    private final ApplicationEventPublisher eventPublisher;

    public ContactService(
        ContactMessageRepository contactMessageRepository,
        ClientIpHasher clientIpHasher,
        InMemoryRateLimiter rateLimiter,
        ApplicationEventPublisher eventPublisher
    ) {
        this.contactMessageRepository = contactMessageRepository;
        this.clientIpHasher = clientIpHasher;
        this.rateLimiter = rateLimiter;
        this.eventPublisher = eventPublisher;
    }

    @Transactional
    public ContactMessageAck submit(ContactMessageWriteRequest request, HttpServletRequest httpRequest) {
        // In memory, not counted from contact_message rows (#309). Counting rows meant storing
        // the sender's ClientIpHasher value with every message, and that hash is unsalted: with
        // only ~4.3 billion IPv4 addresses it is reversed by hashing them all, so the column held
        // the address in all but name. Nothing about the sender's address is stored now. The
        // accepted cost is that the limit resets when the process restarts.
        //
        // Namespaced ("contact:" prefix), like every other caller's key. A bare hash could not
        // collide with today's keys, which are all prefixed, but it would be the one unprefixed
        // key in a shared singleton: a later caller that also keyed on a bare hash would share its
        // bucket and its count. The prefix is 8 characters, a length no other caller's prefix has,
        // so with every key ending in a 64-character hash no two callers' keys can be equal.
        String ipHash = clientIpHasher.hashOf(httpRequest);
        if (!rateLimiter.tryAcquire("contact:" + ipHash, MAX_MESSAGES_PER_WINDOW, RATE_LIMIT_WINDOW)) {
            throw new RateLimitExceededException("Too many contact messages from this requester");
        }

        ContactMessage message = new ContactMessage(request.name(), request.email(), request.message());
        // saveAndFlush: same @CreationTimestamp flush-timing reason as ProjectService - the
        // ack DTO needs createdAt populated before it's built, not deferred to commit.
        ContactMessage saved = contactMessageRepository.saveAndFlush(message);

        // Published inside the transaction on purpose: ContactNotificationListener is an
        // @TransactionalEventListener bound to AFTER_COMMIT, so Spring holds this until the row is
        // durable and drops it entirely if the transaction rolls back. Nothing about notifying the
        // owner may affect what the visitor gets back -- see that listener's class comment, and
        // AGENT_LOG.md 2026-08-01 for the time this project got it wrong in requestReset.
        eventPublisher.publishEvent(ContactMessageReceivedEvent.from(saved));

        return ContactMessageAck.from(saved);
    }

    @Transactional(readOnly = true)
    public PageResponse<ContactMessageResponse> listMessages(Pageable pageable) {
        Page<ContactMessage> page = contactMessageRepository.findAll(pageable);
        return PageResponse.from(page, page.getContent().stream().map(ContactMessageResponse::from).toList());
    }

    @Transactional(readOnly = true)
    public ContactMessageResponse getMessage(UUID id) {
        return ContactMessageResponse.from(findMessageOrThrow(id));
    }

    @Transactional
    public void deleteMessage(UUID id) {
        contactMessageRepository.delete(findMessageOrThrow(id));
    }

    private ContactMessage findMessageOrThrow(UUID id) {
        return contactMessageRepository.findById(id)
            .orElseThrow(() -> new ResourceNotFoundException("Contact message not found: " + id));
    }
}
