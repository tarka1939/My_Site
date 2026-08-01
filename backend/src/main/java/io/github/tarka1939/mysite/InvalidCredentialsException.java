package io.github.tarka1939.mysite;

/**
 * Thrown on a failed login attempt (unknown username OR wrong password — deliberately not
 * distinguished, to avoid leaking which part was wrong). Caught centrally by
 * {@link GlobalExceptionHandler} and translated to a 401 ProblemDetail.
 *
 * <p>Lives in the root package (not {@code auth}) for the same reason as
 * {@link ResourceNotFoundException}: modules throw it, only the root's
 * {@code GlobalExceptionHandler} catches it. Keeping it in {@code auth} instead created a
 * Spring Modulith cycle (root -> auth via GlobalExceptionHandler, auth -> root via
 * PasswordResetService's use of {@link ClientIpHasher}/{@link InMemoryRateLimiter}) —
 * {@code ApplicationModules.verify()} caught this exactly as designed.
 */
public class InvalidCredentialsException extends RuntimeException {

    public InvalidCredentialsException(String message) {
        super(message);
    }
}
