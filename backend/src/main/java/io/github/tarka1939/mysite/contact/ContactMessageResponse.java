package io.github.tarka1939.mysite.contact;

import java.time.Instant;
import java.util.UUID;

public record ContactMessageResponse(UUID id, String name, String email, String message, Instant createdAt) {

    static ContactMessageResponse from(ContactMessage message) {
        return new ContactMessageResponse(
            message.getId(), message.getName(), message.getEmail(), message.getMessage(), message.getCreatedAt());
    }
}
