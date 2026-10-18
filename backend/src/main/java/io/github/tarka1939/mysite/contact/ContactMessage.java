package io.github.tarka1939.mysite.contact;

import java.time.Instant;
import java.util.UUID;

import org.hibernate.annotations.CreationTimestamp;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

/**
 * What a visitor sent through the contact form, and nothing about where they sent it from.
 *
 * <p>There is deliberately no address-derived field. {@code requester_ip_hash} used to be one,
 * kept only so the rate limit could count rows; it was an unsalted, reversible hash, and V10
 * dropped it when the limit moved into {@code InMemoryRateLimiter} (#309). A new field that
 * records anything about the requester's address needs the same scrutiny before it is added.
 */
@Entity
@Table(name = "contact_message")
public class ContactMessage {

    @Id
    @GeneratedValue
    private UUID id;

    @Column(nullable = false, length = 200)
    private String name;

    @Column(nullable = false, length = 320)
    private String email;

    @Column(nullable = false, columnDefinition = "text")
    private String message;

    @CreationTimestamp
    @Column(nullable = false, updatable = false)
    private Instant createdAt;

    protected ContactMessage() {
        // JPA
    }

    public ContactMessage(String name, String email, String message) {
        this.name = name;
        this.email = email;
        this.message = message;
    }

    public UUID getId() {
        return id;
    }

    public String getName() {
        return name;
    }

    public String getEmail() {
        return email;
    }

    public String getMessage() {
        return message;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
