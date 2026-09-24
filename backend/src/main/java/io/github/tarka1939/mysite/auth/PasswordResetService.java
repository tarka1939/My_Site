package io.github.tarka1939.mysite.auth;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Base64;
import java.util.HexFormat;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import io.github.tarka1939.mysite.ClientIpHasher;
import io.github.tarka1939.mysite.InMemoryRateLimiter;
import io.github.tarka1939.mysite.InvalidResetTokenException;
import io.github.tarka1939.mysite.RateLimitExceededException;
import io.github.tarka1939.mysite.ResendEmailClient;

import jakarta.servlet.http.HttpServletRequest;

@Service
public class PasswordResetService {

    private static final Logger log = LoggerFactory.getLogger(PasswordResetService.class);

    private static final long TOKEN_TTL_MINUTES = 30;
    private static final int MAX_RESET_REQUESTS_PER_WINDOW = 5;
    private static final Duration RATE_LIMIT_WINDOW = Duration.ofHours(1);
    // Validation is a page-load side effect, not a user action: a legitimate visitor spends one
    // per opened link plus a few on refreshes, so the budget is looser than requestReset's 5/hour
    // while still capping how fast the endpoint can be used as a bulk validity oracle. The window
    // is under RATE_LIMIT_WINDOW above, so this caller does not widen InMemoryRateLimiter's
    // observed longest window and cannot change how long its sweep retains anyone else's keys.
    private static final int MAX_VALIDATIONS_PER_WINDOW = 10;
    private static final Duration VALIDATION_RATE_LIMIT_WINDOW = Duration.ofMinutes(15);

    private final AdminUserRepository adminUserRepository;
    private final PasswordResetTokenRepository passwordResetTokenRepository;
    private final PasswordEncoder passwordEncoder;
    private final ResendEmailClient resendEmailClient;
    private final ClientIpHasher clientIpHasher;
    private final InMemoryRateLimiter rateLimiter;
    private final String frontendUrl;
    private final SecureRandom secureRandom = new SecureRandom();

    public PasswordResetService(
        AdminUserRepository adminUserRepository,
        PasswordResetTokenRepository passwordResetTokenRepository,
        PasswordEncoder passwordEncoder,
        ResendEmailClient resendEmailClient,
        ClientIpHasher clientIpHasher,
        InMemoryRateLimiter rateLimiter,
        @Value("${app.frontend-url}") String frontendUrl
    ) {
        this.adminUserRepository = adminUserRepository;
        this.passwordResetTokenRepository = passwordResetTokenRepository;
        this.passwordEncoder = passwordEncoder;
        this.resendEmailClient = resendEmailClient;
        this.clientIpHasher = clientIpHasher;
        this.rateLimiter = rateLimiter;
        this.frontendUrl = frontendUrl;
    }

    /**
     * Always succeeds from the caller's perspective (202, regardless of whether the email
     * matched an account) to avoid email enumeration -- see docs/openapi.yaml's
     * requestPasswordReset description. Rate-limited per requester IP hash so this can't be
     * used to spam the mailbox behind a given email address.
     */
    @Transactional
    public void requestReset(PasswordResetRequestBody request, HttpServletRequest httpRequest) {
        String ipHash = clientIpHasher.hashOf(httpRequest);
        // Namespaced ("password-reset:" prefix) for the same reason AuthService.login
        // namespaces its key with "login:" -- InMemoryRateLimiter is a shared singleton, and
        // an unprefixed key would let this collide with login's independent rate limit on the
        // same IP.
        if (!rateLimiter.tryAcquire("password-reset:" + ipHash, MAX_RESET_REQUESTS_PER_WINDOW, RATE_LIMIT_WINDOW)) {
            throw new RateLimitExceededException("Too many password reset requests");
        }

        adminUserRepository.findByEmailIgnoreCase(request.email()).ifPresent(adminUser -> {
            String rawToken = generateRawToken();
            String tokenHash = sha256Hex(rawToken);
            Instant expiresAt = Instant.now().plus(TOKEN_TTL_MINUTES, ChronoUnit.MINUTES);

            passwordResetTokenRepository.save(new PasswordResetToken(adminUser.getId(), tokenHash, expiresAt));

            String resetLink = frontendUrl + "/reset-password?token=" + rawToken;
            try {
                // Must not propagate: this method is documented to always return 202 from the
                // caller's perspective regardless of whether the email matched an account, to
                // avoid email enumeration. A Resend failure (non-2xx, network error) escaping
                // uncaught here would produce a different response for a known-email-but-Resend-
                // hiccupped request than for an unknown-email request, reopening exactly the
                // side channel this design exists to close. The token is already persisted
                // above, so a failed send here doesn't lose anything worth rolling back for.
                resendEmailClient.sendPasswordResetEmail(adminUser.getEmail(), resetLink);
            } catch (RuntimeException e) {
                log.warn("Failed to send password reset email (request still returns 202)", e);
            }
        });
    }

    /**
     * Reports whether a reset token is still usable, so the reset page can refuse to render a
     * password form for a spent link instead of letting the visitor compose a new password and
     * only then discover the link is dead (issue #187). Returns normally when the token is
     * usable; throws {@link InvalidResetTokenException} otherwise.
     *
     * <h2>This is a read. It must never consume the token.</h2>
     * {@link #confirmReset} consumes via {@code markUsedIfValid}, an atomic conditional UPDATE;
     * reusing that here would burn the token the moment the page loaded and actively break the
     * flow this method exists to improve. It goes through
     * {@link PasswordResetTokenRepository#existsUsableToken} instead -- a COUNT projection, no
     * {@code @Modifying}, no entity loaded to be dirty-checked. That projection is the real
     * guarantee, and it holds from every call site.
     *
     * <p>The {@code readOnly} transaction adds a second layer -- Hibernate's flush mode goes to
     * MANUAL -- but only <em>on the controller path, where this method starts its own
     * transaction</em>. {@code @Transactional}'s default propagation is REQUIRED, so a call from
     * inside an existing read-write transaction joins it and {@code readOnly} is ignored. Do not
     * rely on that layer from a nested call site; rely on the projection.
     *
     * <h2>Why this may answer truthfully, when requestReset may not</h2>
     * {@link #requestReset} always returns 202 because its caller supplies an *email address*,
     * which it may not own, and a truthful answer would confirm whether an account exists. The
     * asymmetry here is that the caller already holds the token: it can learn the same fact by
     * POSTing the reset form, at the cost of one extra request and a typed password. So the
     * answer discloses nothing new -- what it does is make the oracle *cheaper*, which is why
     * the rate limit below is not optional. Guessing a token outright is not the threat model
     * (32 bytes from SecureRandom); cheap bulk confirmation of tokens harvested elsewhere -- a
     * mailbox, a proxy log, a shoulder-surfed URL -- is.
     *
     * <p>Nothing distinguishes the failure cases. Never-issued, already-used, expired and
     * malformed tokens all raise the same exception with the same message, and the repository
     * answers with a boolean so there is nothing at this level to tell them apart with. The two
     * DB paths are one indexed lookup on the same unique index either way, so the remaining
     * timing difference is a hit-versus-miss on one B-tree probe -- far below network noise, and
     * it would distinguish "this token was issued at some point" from "never", which is not a
     * fact worth a constant-time lookup on a single-admin site.
     */
    @Transactional(readOnly = true)
    public void validateToken(PasswordResetValidateBody request, HttpServletRequest httpRequest) {
        String ipHash = clientIpHasher.hashOf(httpRequest);
        // A THIRD namespace, not requestReset's "password-reset:" bucket. Three reasons, and the
        // first is a bug this project has already shipped once (see CLAUDE.md's shared-components
        // rule): InMemoryRateLimiter is a singleton keyed only by the string passed to it, so
        // sharing "password-reset:" would mean a few page loads of the reset link silently
        // consuming the budget for actually *requesting* a reset email, locking an admin out of
        // recovery. Second, the two want different budgets -- sending mail is expensive and rare,
        // loading a page is cheap and repeatable. Third, InMemoryRateLimiter documents one window
        // per key, and these use different windows, so sharing a key would corrupt both counts.
        //
        // The prefixes cannot collide by construction, not merely by inspection: every key is a
        // prefix plus a 64-char SHA-256 hex hash, so two keys built from different prefixes have
        // different lengths ("login:" 6, "password-reset:" 15, "password-reset-validate:" 24) and
        // can never be equal, whatever the hashes.
        if (!rateLimiter.tryAcquire(
            "password-reset-validate:" + ipHash, MAX_VALIDATIONS_PER_WINDOW, VALIDATION_RATE_LIMIT_WINDOW)) {
            throw new RateLimitExceededException("Too many password reset token checks");
        }

        if (!passwordResetTokenRepository.existsUsableToken(sha256Hex(request.token()), Instant.now())) {
            // Same exception, same message, as confirmReset's rejection -- so both endpoints
            // produce the identical 400 body (title "Invalid Reset Token", one field error keyed
            // "token"). The frontend branches on that shape for both; divergence here would be a
            // trap for whoever writes it.
            throw new InvalidResetTokenException("Invalid or expired reset token");
        }
    }

    @Transactional
    public void confirmReset(PasswordResetConfirmBody request) {
        String tokenHash = sha256Hex(request.token());
        Instant now = Instant.now();

        // Atomic conditional update first (see PasswordResetTokenRepository.markUsedIfValid),
        // not a find-then-validate-then-update -- the latter has a check-then-act window
        // between two concurrent requests racing the same leaked token.
        int updated = passwordResetTokenRepository.markUsedIfValid(tokenHash, now);
        if (updated == 0) {
            throw new InvalidResetTokenException("Invalid or expired reset token");
        }

        PasswordResetToken resetToken = passwordResetTokenRepository.findByTokenHash(tokenHash)
            .orElseThrow(() -> new InvalidResetTokenException("Invalid or expired reset token"));
        AdminUser adminUser = adminUserRepository.findById(resetToken.getAdminUserId())
            .orElseThrow(() -> new InvalidResetTokenException("Invalid or expired reset token"));

        adminUser.setPasswordHash(passwordEncoder.encode(request.newPassword()));
    }

    private String generateRawToken() {
        byte[] bytes = new byte[32];
        secureRandom.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private String sha256Hex(String value) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(value.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(hash);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 not available", e);
        }
    }
}
