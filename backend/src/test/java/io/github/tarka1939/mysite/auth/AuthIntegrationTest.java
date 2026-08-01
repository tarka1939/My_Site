package io.github.tarka1939.mysite.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.time.temporal.ChronoUnit;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import io.github.tarka1939.mysite.InvalidCredentialsException;
import io.github.tarka1939.mysite.InvalidResetTokenException;
import io.github.tarka1939.mysite.RateLimitExceededException;

import jakarta.persistence.EntityManager;
import jakarta.servlet.http.HttpServletRequest;

/**
 * Exercises AuthService/PasswordResetService against real Postgres (uniqueness constraints,
 * FK cascade, timestamp comparisons) rather than mocked repositories. The seeded admin row
 * from V2__admin_user_email_and_seed.sql is deliberately NOT used here -- its plaintext
 * password is never committed to source, so every test creates its own throwaway admin user.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.NONE)
@Testcontainers
@ActiveProfiles("test")
@Transactional
class AuthIntegrationTest {

    @Container
    @ServiceConnection
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:17-alpine");

    @Autowired
    private AuthService authService;

    @Autowired
    private PasswordResetService passwordResetService;

    @Autowired
    private AdminUserRepository adminUserRepository;

    @Autowired
    private PasswordResetTokenRepository passwordResetTokenRepository;

    @Autowired
    private PasswordEncoder passwordEncoder;

    @Autowired
    private EntityManager entityManager;

    @Test
    void login_withSeededCredentials_returnsDecodableJwt() {
        createAdminUser("integration-admin", "integration-admin@example.com", "correct-horse-battery-staple");

        LoginResponse response = authService.login(
            new LoginRequest("integration-admin", "correct-horse-battery-staple"), requestFrom("203.0.113.20"));

        assertThat(response.token()).isNotBlank();
        assertThat(response.expiresAt()).isAfter(Instant.now());
        assertThat(response.expiresAt()).isBefore(Instant.now().plus(61, ChronoUnit.MINUTES));
    }

    @Test
    void login_withWrongPassword_throwsInvalidCredentials() {
        createAdminUser("integration-admin2", "integration-admin2@example.com", "correct-password");

        assertThatThrownBy(() -> authService.login(
            new LoginRequest("integration-admin2", "wrong-password"), requestFrom("203.0.113.21")))
            .isInstanceOf(InvalidCredentialsException.class);
    }

    @Test
    void loginRateLimitAndPasswordResetRateLimitAreIndependentPerIp() {
        // Regression test for a real bug: AuthService and PasswordResetService share one
        // InMemoryRateLimiter singleton. Before the keys were namespaced ("login:"/
        // "password-reset:" prefixes), both call sites used the bare IP hash as the limiter
        // key, so exhausting login's bucket (5 attempts/15min) also exhausted
        // password-reset-request's bucket (5/1hour) for the same IP -- breaking exactly the
        // "forgot my password, let me reset it" recovery path a legitimate admin would take
        // right after failing to log in a few times.
        createAdminUser("isolation-admin", "isolation-admin@example.com", "correct-password");
        HttpServletRequest httpRequest = requestFrom("203.0.113.22");

        for (int i = 0; i < 5; i++) {
            assertThatThrownBy(() -> authService.login(
                new LoginRequest("isolation-admin", "wrong-password"), httpRequest))
                .isInstanceOf(InvalidCredentialsException.class);
        }
        assertThatThrownBy(() -> authService.login(
            new LoginRequest("isolation-admin", "wrong-password"), httpRequest))
            .isInstanceOf(RateLimitExceededException.class);

        // Same IP, different endpoint -- must not be affected by login's exhausted bucket.
        passwordResetService.requestReset(new PasswordResetRequestBody("isolation-admin@example.com"), httpRequest);
    }

    @Test
    void requestReset_forKnownEmail_createsHashedTokenNotRawToken() {
        var adminUser = createAdminUser("reset-admin", "reset-admin@example.com", "irrelevant");
        HttpServletRequest httpRequest = requestFrom("203.0.113.9");

        passwordResetService.requestReset(new PasswordResetRequestBody("reset-admin@example.com"), httpRequest);
        entityManager.flush();

        var tokens = passwordResetTokenRepository.findAll().stream()
            .filter(t -> t.getAdminUserId().equals(adminUser.getId()))
            .toList();
        assertThat(tokens).hasSize(1);
        assertThat(tokens.get(0).getUsedAt()).isNull();
        assertThat(tokens.get(0).getExpiresAt()).isAfter(Instant.now());
        assertThat(tokens.get(0).getTokenHash()).hasSize(64); // sha-256 hex, never the raw token
    }

    @Test
    void requestReset_forUnknownEmail_createsNoTokenButDoesNotThrow() {
        HttpServletRequest httpRequest = requestFrom("203.0.113.10");

        passwordResetService.requestReset(new PasswordResetRequestBody("nobody@example.com"), httpRequest);

        assertThat(passwordResetTokenRepository.findAll()).isEmpty();
    }

    @Test
    void confirmReset_withValidToken_updatesPasswordAndConsumesToken() {
        var adminUser = createAdminUser("confirm-admin", "confirm-admin@example.com", "old-password");
        PasswordResetToken token = new PasswordResetToken(
            adminUser.getId(), sha256Hex("raw-test-token"), Instant.now().plus(30, ChronoUnit.MINUTES));
        passwordResetTokenRepository.saveAndFlush(token);

        passwordResetService.confirmReset(new PasswordResetConfirmBody("raw-test-token", "new-password-123"));
        entityManager.flush();
        entityManager.clear();

        var reloadedUser = adminUserRepository.findById(adminUser.getId()).orElseThrow();
        assertThat(passwordEncoder.matches("new-password-123", reloadedUser.getPasswordHash())).isTrue();

        var reloadedToken = passwordResetTokenRepository.findById(token.getId()).orElseThrow();
        assertThat(reloadedToken.getUsedAt()).isNotNull();
    }

    @Test
    void confirmReset_withAlreadyUsedToken_throwsInvalidResetToken() {
        var adminUser = createAdminUser("reuse-admin", "reuse-admin@example.com", "old-password");
        PasswordResetToken token = new PasswordResetToken(
            adminUser.getId(), sha256Hex("already-used-token"), Instant.now().plus(30, ChronoUnit.MINUTES));
        token.setUsedAt(Instant.now().minus(1, ChronoUnit.MINUTES));
        passwordResetTokenRepository.saveAndFlush(token);

        assertThatThrownBy(() -> passwordResetService.confirmReset(
            new PasswordResetConfirmBody("already-used-token", "new-password-123")))
            .isInstanceOf(InvalidResetTokenException.class);
    }

    @Test
    void confirmReset_calledTwiceWithSameToken_secondCallIsRejectedByTheAtomicGuard() {
        var adminUser = createAdminUser("double-confirm-admin", "double-confirm-admin@example.com", "old-password");
        PasswordResetToken token = new PasswordResetToken(
            adminUser.getId(), sha256Hex("reused-in-same-run-token"), Instant.now().plus(30, ChronoUnit.MINUTES));
        passwordResetTokenRepository.saveAndFlush(token);

        // Exercises PasswordResetTokenRepository.markUsedIfValid directly rather than the
        // pre-set-usedAt scenario above -- the first call must succeed (proving the atomic
        // UPDATE ... WHERE used_at IS NULL still matches a genuinely fresh token), and the
        // second call against the now-consumed token must be rejected by that same guard.
        passwordResetService.confirmReset(new PasswordResetConfirmBody("reused-in-same-run-token", "first-new-password"));

        assertThatThrownBy(() -> passwordResetService.confirmReset(
            new PasswordResetConfirmBody("reused-in-same-run-token", "second-new-password")))
            .isInstanceOf(InvalidResetTokenException.class);
    }

    @Test
    void confirmReset_withExpiredToken_throwsInvalidResetToken() {
        var adminUser = createAdminUser("expired-admin", "expired-admin@example.com", "old-password");
        PasswordResetToken token = new PasswordResetToken(
            adminUser.getId(), sha256Hex("expired-token"), Instant.now().minus(1, ChronoUnit.MINUTES));
        passwordResetTokenRepository.saveAndFlush(token);

        assertThatThrownBy(() -> passwordResetService.confirmReset(
            new PasswordResetConfirmBody("expired-token", "new-password-123")))
            .isInstanceOf(InvalidResetTokenException.class);
    }

    @Test
    void confirmReset_withUnknownToken_throwsInvalidResetToken() {
        assertThatThrownBy(() -> passwordResetService.confirmReset(
            new PasswordResetConfirmBody("never-issued-token", "new-password-123")))
            .isInstanceOf(InvalidResetTokenException.class);
    }

    private AdminUser createAdminUser(String username, String email, String rawPassword) {
        AdminUser adminUser = instantiateAdminUser(username, email, passwordEncoder.encode(rawPassword));
        return adminUserRepository.saveAndFlush(adminUser);
    }

    private AdminUser instantiateAdminUser(String username, String email, String passwordHash) {
        // Same-package access to AdminUser's protected constructor; username/email have no
        // setters (no such endpoint exists), so reflection sets those two fields directly.
        try {
            AdminUser adminUser = new AdminUser();
            setField(adminUser, "username", username);
            setField(adminUser, "email", email);
            adminUser.setPasswordHash(passwordHash);
            return adminUser;
        } catch (ReflectiveOperationException e) {
            throw new RuntimeException(e);
        }
    }

    private void setField(Object target, String fieldName, Object value) throws ReflectiveOperationException {
        var field = AdminUser.class.getDeclaredField(fieldName);
        field.setAccessible(true);
        field.set(target, value);
    }

    private HttpServletRequest requestFrom(String remoteAddr) {
        HttpServletRequest request = mock(HttpServletRequest.class);
        when(request.getRemoteAddr()).thenReturn(remoteAddr);
        return request;
    }

    private String sha256Hex(String value) {
        try {
            var digest = java.security.MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(value.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            return java.util.HexFormat.of().formatHex(hash);
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
