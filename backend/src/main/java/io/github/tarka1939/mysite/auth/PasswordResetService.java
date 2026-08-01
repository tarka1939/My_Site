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

import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import io.github.tarka1939.mysite.ClientIpHasher;
import io.github.tarka1939.mysite.InMemoryRateLimiter;
import io.github.tarka1939.mysite.InvalidResetTokenException;
import io.github.tarka1939.mysite.RateLimitExceededException;

import jakarta.servlet.http.HttpServletRequest;

@Service
public class PasswordResetService {

    private static final long TOKEN_TTL_MINUTES = 30;
    private static final int MAX_RESET_REQUESTS_PER_WINDOW = 5;
    private static final Duration RATE_LIMIT_WINDOW = Duration.ofHours(1);

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
        if (!rateLimiter.tryAcquire(ipHash, MAX_RESET_REQUESTS_PER_WINDOW, RATE_LIMIT_WINDOW)) {
            throw new RateLimitExceededException("Too many password reset requests");
        }

        adminUserRepository.findByEmailIgnoreCase(request.email()).ifPresent(adminUser -> {
            String rawToken = generateRawToken();
            String tokenHash = sha256Hex(rawToken);
            Instant expiresAt = Instant.now().plus(TOKEN_TTL_MINUTES, ChronoUnit.MINUTES);

            passwordResetTokenRepository.save(new PasswordResetToken(adminUser.getId(), tokenHash, expiresAt));

            String resetLink = frontendUrl + "/reset-password?token=" + rawToken;
            resendEmailClient.sendPasswordResetEmail(adminUser.getEmail(), resetLink);
        });
    }

    @Transactional
    public void confirmReset(PasswordResetConfirmBody request) {
        String tokenHash = sha256Hex(request.token());
        PasswordResetToken resetToken = passwordResetTokenRepository.findByTokenHash(tokenHash)
            .orElseThrow(() -> new InvalidResetTokenException("Invalid or expired reset token"));

        if (resetToken.getUsedAt() != null || resetToken.getExpiresAt().isBefore(Instant.now())) {
            throw new InvalidResetTokenException("Invalid or expired reset token");
        }

        AdminUser adminUser = adminUserRepository.findById(resetToken.getAdminUserId())
            .orElseThrow(() -> new InvalidResetTokenException("Invalid or expired reset token"));

        adminUser.setPasswordHash(passwordEncoder.encode(request.newPassword()));
        resetToken.setUsedAt(Instant.now());
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
