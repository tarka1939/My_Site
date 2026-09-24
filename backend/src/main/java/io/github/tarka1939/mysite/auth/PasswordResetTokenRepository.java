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

    /**
     * Pure read: is this token real, unused and unexpired right now?
     *
     * <p>The predicate is deliberately character-for-character the one in
     * {@link #markUsedIfValid} -- these two must agree on what "valid" means, or a token could
     * validate here and then be refused on submission (or the reverse). Kept as a
     * {@code COUNT(...) > 0} projection rather than reusing {@link #findByTokenHash}: nothing is
     * loaded into the persistence context, so there is no managed entity for a dirty check to
     * flush, and no {@code @Modifying} annotation, so this cannot write. Validation must not
     * consume the token -- the reset page calls it on load, and consuming here would break the
     * exact flow the endpoint exists to improve (issue #187).
     *
     * <p>Answering with a boolean also keeps the three failure cases (never existed, already
     * used, expired) indistinguishable at the call site: there is nothing left to tell them
     * apart with.
     *
     * <p>Served by ux_password_reset_token_hash (V3) -- token_hash alone is unique, so the two
     * extra predicates are filters on at most one row and need no further index.
     */
    @Query("SELECT COUNT(t) > 0 FROM PasswordResetToken t "
        + "WHERE t.tokenHash = :tokenHash AND t.usedAt IS NULL AND t.expiresAt > :now")
    boolean existsUsableToken(@Param("tokenHash") String tokenHash, @Param("now") Instant now);
}
