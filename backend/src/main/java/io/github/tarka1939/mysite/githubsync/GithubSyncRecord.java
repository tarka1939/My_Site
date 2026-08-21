package io.github.tarka1939.mysite.githubsync;

import java.time.Instant;
import java.util.UUID;

import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

/**
 * One accepted GitHub webhook delivery. See {@code V6__github_sync_record.sql} for why this
 * carries no {@code project_id} or {@code last_synced_at} yet.
 *
 * <p>Read-only from JPA's point of view in Phase 7a: rows are written by
 * {@link GithubSyncRecordRepository#insertIfAbsent} as a single atomic
 * {@code INSERT ... ON CONFLICT DO NOTHING}, never by {@code save()}. That is the whole
 * idempotency design -- see the repository -- so this class deliberately has no public
 * constructor and no setters to save through.
 */
@Entity
@Table(name = "github_sync_record")
public class GithubSyncRecord {

    @Id
    @GeneratedValue
    private UUID id;

    @Column(name = "github_delivery_id", nullable = false, length = 255)
    private String githubDeliveryId;

    @Column(name = "event_type", nullable = false, length = 100)
    private String eventType;

    /** Null when the delivery named no repository -- an organization-level {@code ping}, say. */
    @Column(name = "repo_full_name", length = 255)
    private String repoFullName;

    @Column(name = "received_at", nullable = false, updatable = false)
    private Instant receivedAt;

    /**
     * The delivery body as {@code jsonb} -- equal in content to what arrived, but not in form.
     * jsonb parses rather than stores text, so whitespace is gone, keys are reordered and
     * escapes are resolved. Do not treat this as the signed octets; they are not recoverable
     * from here. {@code @JdbcTypeCode(SqlTypes.JSON)} is what maps a String field onto a
     * Postgres {@code jsonb} column in Hibernate 6 -- without it the driver hands back a
     * {@code PGobject} that will not cast to String.
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "raw_payload")
    private String rawPayload;

    protected GithubSyncRecord() {
        // JPA
    }

    public UUID getId() {
        return id;
    }

    public String getGithubDeliveryId() {
        return githubDeliveryId;
    }

    public String getEventType() {
        return eventType;
    }

    public String getRepoFullName() {
        return repoFullName;
    }

    public Instant getReceivedAt() {
        return receivedAt;
    }

    public String getRawPayload() {
        return rawPayload;
    }
}
