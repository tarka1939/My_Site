package io.github.tarka1939.mysite.contact;

import java.time.Instant;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

public interface ContactMessageRepository extends JpaRepository<ContactMessage, UUID> {

    /** Backs the rate-limit check described in docs/DATA_MODEL.md — no separate table. */
    long countByRequesterIpHashAndCreatedAtAfter(String requesterIpHash, Instant cutoff);
}
