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
 * Phase 1 scope: schema + entity mapping only. The submission endpoint and rate limiting
 * are Phase 2 work — see PROJECT_TODO.md.
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

    @Column(name = "requester_ip_hash", nullable = false, length = 64)
    private String requesterIpHash;

    protected ContactMessage() {
        // JPA
    }

    public ContactMessage(String name, String email, String message, String requesterIpHash) {
        this.name = name;
        this.email = email;
        this.message = message;
        this.requesterIpHash = requesterIpHash;
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

    public String getRequesterIpHash() {
        return requesterIpHash;
    }
}
