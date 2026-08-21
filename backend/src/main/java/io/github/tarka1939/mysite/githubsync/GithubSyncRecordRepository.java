package io.github.tarka1939.mysite.githubsync;

import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

public interface GithubSyncRecordRepository extends JpaRepository<GithubSyncRecord, UUID> {

    /**
     * Supported by {@code ux_github_sync_record_delivery_id}, created in the same migration as
     * the table -- per CLAUDE.md's rule that a query on a non-primary-key column brings its own
     * index rather than waiting for a cleanup pass.
     *
     * <p>Note what this is <i>not</i> for: it must never be used to decide whether to insert.
     * See {@link #insertIfAbsent}.
     */
    Optional<GithubSyncRecord> findByGithubDeliveryId(String githubDeliveryId);

    /**
     * Records a delivery, atomically, and reports whether it was new.
     *
     * <p>This is the shape CLAUDE.md's correctness checklist calls out as a standing risk in
     * this codebase, and it has already bitten three times: asking "have I seen this delivery
     * id?" and then inserting is a check-then-act race, and two concurrent redeliveries of the
     * same id would both read "no" and both insert. Only one of them would fail, and only
     * because of the unique index -- so the index is doing the real work either way, and the
     * pre-check adds nothing but a round trip and a false sense of safety. GitHub redelivers
     * both on its own retry schedule and on a human clicking "Redeliver", so concurrent
     * duplicates are ordinary traffic here, not a thought experiment.
     *
     * <p>{@code ON CONFLICT DO NOTHING} pushes the whole decision into one statement the
     * database resolves under its own locking. The alternative -- {@code saveAndFlush} inside a
     * try/catch for {@code DataIntegrityViolationException} -- is also atomic but leaves the
     * persistence context and the transaction poisoned (Hibernate marks it rollback-only), so
     * the "duplicate" path could not then go on to do anything useful.
     *
     * <p>{@code @Transactional} sits here, on the repository method, rather than on the calling
     * service method, so that this insert has committed by the time
     * {@link GithubSyncService#accept} publishes its event -- see the note there.
     *
     * @return 1 if the row was inserted, 0 if this delivery id was already recorded
     */
    @Transactional
    @Modifying
    @Query(value = """
        INSERT INTO github_sync_record (id, github_delivery_id, event_type, repo_full_name, raw_payload)
        VALUES (:id, :deliveryId, :eventType, :repoFullName, CAST(:rawPayload AS jsonb))
        ON CONFLICT (github_delivery_id) DO NOTHING
        """, nativeQuery = true)
    int insertIfAbsent(
        @Param("id") UUID id,
        @Param("deliveryId") String deliveryId,
        @Param("eventType") String eventType,
        @Param("repoFullName") String repoFullName,
        @Param("rawPayload") String rawPayload);
}
