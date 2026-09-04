package io.github.tarka1939.mysite.contact;

import java.time.Instant;
import java.util.UUID;

/**
 * Published by {@link ContactService#submit} once a visitor's message is persisted. Issue #186.
 *
 * <p>Carries the submitted content rather than only the id, deliberately. A listener holding just
 * the id would have to re-read the row after the transaction commits, which is a check-then-act
 * shape of the kind CLAUDE.md's concurrency rule warns about: the admin can delete a message
 * between the commit and the listener running, and the notification would silently vanish for the
 * one message the owner most needs to see. Carrying the values removes the second read entirely.
 *
 * <p>Consequently this record holds visitor PII (name, email, message body). That is fine while
 * events are in-memory only. If {@code spring-modulith-events} durable publication is ever
 * adopted (docs/DECISIONS.md lists it as undecided), this event would start being serialized into
 * a database table, and that is a decision to take deliberately rather than inherit — at which
 * point carrying only {@link #messageId()} becomes the better trade.
 */
public record ContactMessageReceivedEvent(
    UUID messageId,
    Instant receivedAt,
    String visitorName,
    String visitorEmail,
    String message
) {

    static ContactMessageReceivedEvent from(ContactMessage message) {
        return new ContactMessageReceivedEvent(
            message.getId(),
            message.getCreatedAt(),
            message.getName(),
            message.getEmail(),
            message.getMessage());
    }
}
