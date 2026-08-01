package io.github.tarka1939.mysite.auth;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface PasswordResetTokenRepository extends JpaRepository<PasswordResetToken, UUID> {

    Optional<PasswordResetToken> findByTokenHash(String tokenHash);

    /**
     * Atomically marks a token used only if it's still valid (exists, unused, unexpired) --
     * the WHERE clause is the whole point: a separate find-then-check-then-update (the
     * original shape) leaves a check-then-act window where two concurrent requests racing the
     * same leaked token could both pass validation before either commits. Returns the number
     * of rows updated (0 or 1) so the caller can tell "already consumed by a concurrent
     * request" apart from "never existed" without a second query.
     */
    @Modifying
    @Query("UPDATE PasswordResetToken t SET t.usedAt = :now "
        + "WHERE t.tokenHash = :tokenHash AND t.usedAt IS NULL AND t.expiresAt > :now")
    int markUsedIfValid(@Param("tokenHash") String tokenHash, @Param("now") Instant now);
}
