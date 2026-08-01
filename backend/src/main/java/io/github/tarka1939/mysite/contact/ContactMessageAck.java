package io.github.tarka1939.mysite.contact;

import java.time.Instant;
import java.util.UUID;

/** Deliberately minimal — does not echo the stored message back, just confirms receipt. */
public record ContactMessageAck(UUID id, Instant createdAt) {

    static ContactMessageAck from(ContactMessage message) {
        return new ContactMessageAck(message.getId(), message.getCreatedAt());
    }
}
