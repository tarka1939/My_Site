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
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

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
    static PostgreSQLContainer postgres = new PostgreSQLContainer("postgres:17-alpine");

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
    void loginRateLimit_behindATrustedProxy_bucketsPerVisitorNotPerProxy() {
        // Issue #168. Deployed, every request reaches this app from the same proxy address, so
        // before ClientIpResolver existed all six attempts below shared one bucket and any
        // stranger could lock the owner out of the admin panel in five requests. The test profile
        // configures 198.51.100.0/24 as the trusted proxy block.
        createAdminUser("proxied-admin", "proxied-admin@example.com", "correct-password");
        HttpServletRequest firstVisitor = requestViaProxy("198.51.100.7", "203.0.113.30");
        HttpServletRequest secondVisitor = requestViaProxy("198.51.100.7", "203.0.113.31");

        for (int i = 0; i < 5; i++) {
            assertThatThrownBy(() -> authService.login(
                new LoginRequest("proxied-admin", "wrong-password"), firstVisitor))
                .isInstanceOf(InvalidCredentialsException.class);
        }
        assertThatThrownBy(() -> authService.login(
            new LoginRequest("proxied-admin", "wrong-password"), firstVisitor))
            .isInstanceOf(RateLimitExceededException.class);

        // The load-bearing assertion: a different visitor arriving through the SAME proxy has an
        // untouched budget. InvalidCredentials, not RateLimitExceeded, is the whole fix.
        assertThatThrownBy(() -> authService.login(
            new LoginRequest("proxied-admin", "wrong-password"), secondVisitor))
            .isInstanceOf(InvalidCredentialsException.class);
    }

    @Test
    void loginRateLimit_forwardedHeaderFromAnUntrustedPeer_isIgnored() {
        // The other half of #168, and the half that would make the fix worse than the bug if it
        // were missing. 203.0.113.41 is not in the configured trusted-proxy block, so it is
        // someone reaching the app directly. Each attempt claims a different visitor address; if
        // the header were believed, each would get its own bucket and rate limiting would be
        // defeated outright rather than merely globalised. All six must land on one bucket keyed
        // on the peer's own address.
        createAdminUser("direct-admin", "direct-admin@example.com", "correct-password");

        for (int i = 0; i < 5; i++) {
            HttpServletRequest forged = requestViaProxy("203.0.113.41", "192.0.2." + (10 + i));
            assertThatThrownBy(() -> authService.login(
                new LoginRequest("direct-admin", "wrong-password"), forged))
                .isInstanceOf(InvalidCredentialsException.class);
        }
        HttpServletRequest forged = requestViaProxy("203.0.113.41", "192.0.2.99");
        assertThatThrownBy(() -> authService.login(
            new LoginRequest("direct-admin", "wrong-password"), forged))
            .isInstanceOf(RateLimitExceededException.class);
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

    @Test
    void validateToken_withUsableToken_returnsAndLeavesTheTokenUsable() {
        var adminUser = createAdminUser("validate-admin", "validate-admin@example.com", "old-password");
        PasswordResetToken token = new PasswordResetToken(
            adminUser.getId(), sha256Hex("validate-live-token"), Instant.now().plus(30, ChronoUnit.MINUTES));
        passwordResetTokenRepository.saveAndFlush(token);
        HttpServletRequest httpRequest = requestFrom("203.0.113.50");

        // The load-bearing test for issue #187. Validation is a read; if it ever went through
        // markUsedIfValid (confirmReset's atomic conditional UPDATE), opening the reset link would
        // burn the token and the feature would break the very flow it exists to improve. Called
        // three times deliberately -- a single call cannot distinguish "does not consume" from
        // "consumes, and the first call happens to be the one that succeeds".
        passwordResetService.validateToken(new PasswordResetValidateBody("validate-live-token"), httpRequest);
        passwordResetService.validateToken(new PasswordResetValidateBody("validate-live-token"), httpRequest);
        passwordResetService.validateToken(new PasswordResetValidateBody("validate-live-token"), httpRequest);
        entityManager.flush();
        entityManager.clear();

        assertThat(passwordResetTokenRepository.findById(token.getId()).orElseThrow().getUsedAt()).isNull();

        // usedAt being null is necessary but not sufficient -- this is the assertion that proves
        // the link a visitor was just shown a form for still actually works.
        passwordResetService.confirmReset(new PasswordResetConfirmBody("validate-live-token", "new-password-123"));
        entityManager.flush();
        entityManager.clear();

        var reloadedUser = adminUserRepository.findById(adminUser.getId()).orElseThrow();
        assertThat(passwordEncoder.matches("new-password-123", reloadedUser.getPasswordHash())).isTrue();
    }

    @Test
    void validateToken_withAlreadyUsedToken_throwsInvalidResetToken() {
        var adminUser = createAdminUser("validate-used-admin", "validate-used-admin@example.com", "old-password");
        PasswordResetToken token = new PasswordResetToken(
            adminUser.getId(), sha256Hex("validate-used-token"), Instant.now().plus(30, ChronoUnit.MINUTES));
        token.setUsedAt(Instant.now().minus(1, ChronoUnit.MINUTES));
        passwordResetTokenRepository.saveAndFlush(token);

        assertThatThrownBy(() -> passwordResetService.validateToken(
            new PasswordResetValidateBody("validate-used-token"), requestFrom("203.0.113.51")))
            .isInstanceOf(InvalidResetTokenException.class)
            .hasMessage("Invalid or expired reset token");
    }

    @Test
    void validateToken_withExpiredToken_throwsInvalidResetToken() {
        var adminUser = createAdminUser("validate-exp-admin", "validate-exp-admin@example.com", "old-password");
        PasswordResetToken token = new PasswordResetToken(
            adminUser.getId(), sha256Hex("validate-expired-token"), Instant.now().minus(1, ChronoUnit.MINUTES));
        passwordResetTokenRepository.saveAndFlush(token);

        assertThatThrownBy(() -> passwordResetService.validateToken(
            new PasswordResetValidateBody("validate-expired-token"), requestFrom("203.0.113.52")))
            .isInstanceOf(InvalidResetTokenException.class)
            // Same type AND same message as the used-token and never-issued cases either side of
            // this one: the endpoint must not let the shape of the failure say which it was. The
            // message is what reaches the client as both detail and the token field error.
            .hasMessage("Invalid or expired reset token");
    }

    @Test
    void validateToken_withUnknownToken_throwsInvalidResetToken() {
        assertThatThrownBy(() -> passwordResetService.validateToken(
            new PasswordResetValidateBody("never-issued-validate-token"), requestFrom("203.0.113.53")))
            .isInstanceOf(InvalidResetTokenException.class)
            .hasMessage("Invalid or expired reset token");
    }

    @Test
    void validateToken_pastItsRateLimit_throwsRateLimitExceeded() {
        var adminUser = createAdminUser("validate-rl-admin", "validate-rl-admin@example.com", "old-password");
        PasswordResetToken token = new PasswordResetToken(
            adminUser.getId(), sha256Hex("validate-rl-token"), Instant.now().plus(30, ChronoUnit.MINUTES));
        passwordResetTokenRepository.saveAndFlush(token);
        HttpServletRequest httpRequest = requestFrom("203.0.113.54");

        // Ten succeed (which also re-confirms the read never consumes), the eleventh does not.
        // Unlimited, this endpoint would be a cheaper validity oracle than the reset form itself.
        for (int i = 0; i < 10; i++) {
            passwordResetService.validateToken(new PasswordResetValidateBody("validate-rl-token"), httpRequest);
        }

        assertThatThrownBy(() -> passwordResetService.validateToken(
            new PasswordResetValidateBody("validate-rl-token"), httpRequest))
            .isInstanceOf(RateLimitExceededException.class);
    }

    @Test
    void validateTokenRateLimit_isItsOwnBucket_notRequestResetsOrLogins() {
        // The namespace-collision regression test. InMemoryRateLimiter is a shared singleton keyed
        // only by the string it is handed, and this project has already shipped one bug of exactly
        // this shape (login reusing password-reset's unnamespaced key -- see CLAUDE.md). If
        // validation shared "password-reset:", a handful of reset-page loads would silently
        // consume the budget for requesting a reset email and lock an admin out of recovery.
        var adminUser = createAdminUser("validate-ns-admin", "validate-ns-admin@example.com", "old-password");
        PasswordResetToken token = new PasswordResetToken(
            adminUser.getId(), sha256Hex("validate-ns-token"), Instant.now().plus(30, ChronoUnit.MINUTES));
        passwordResetTokenRepository.saveAndFlush(token);
        HttpServletRequest httpRequest = requestFrom("203.0.113.55");

        for (int i = 0; i < 10; i++) {
            passwordResetService.validateToken(new PasswordResetValidateBody("validate-ns-token"), httpRequest);
        }

        // Same IP, neighbouring endpoints: both must still have untouched budgets. requestReset
        // adds a second token row for this admin; login gets as far as checking the password.
        passwordResetService.requestReset(new PasswordResetRequestBody("validate-ns-admin@example.com"), httpRequest);
        entityManager.flush();
        assertThat(passwordResetTokenRepository.findAll().stream()
            .filter(t -> t.getAdminUserId().equals(adminUser.getId()))
            .toList()).hasSize(2);
        assertThatThrownBy(() -> authService.login(
            new LoginRequest("validate-ns-admin", "wrong-password"), httpRequest))
            .isInstanceOf(InvalidCredentialsException.class);

        // Asserted last, on purpose: it is the only step here that throws out of a @Transactional
        // service method, which marks this test's surrounding transaction rollback-only. The
        // bucket is monotonic within its 15-minute window, so being exhausted here proves it was
        // already exhausted above -- which is what makes the two assertions above mean anything.
        assertThatThrownBy(() -> passwordResetService.validateToken(
            new PasswordResetValidateBody("validate-ns-token"), httpRequest))
            .isInstanceOf(RateLimitExceededException.class);
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

    /**
     * A request whose TCP peer is {@code peerAddress} and which claims, via the header the test
     * profile names as {@code app.forwarded-headers.client-ip-header}, to be on behalf of
     * {@code claimedVisitorAddress}. Whether that claim is believed is the point of the tests
     * that use it.
     */
    private HttpServletRequest requestViaProxy(String peerAddress, String claimedVisitorAddress) {
        HttpServletRequest request = mock(HttpServletRequest.class);
        when(request.getRemoteAddr()).thenReturn(peerAddress);
        when(request.getHeader("CF-Connecting-IP")).thenReturn(claimedVisitorAddress);
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
