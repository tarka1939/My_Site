package io.github.tarka1939.mysite;

/**
 * Thrown when a password-reset token is missing, already used, or expired. Caught centrally
 * by {@link GlobalExceptionHandler} and translated to a 400 ValidationProblemDetail, matching
 * docs/openapi.yaml's confirmPasswordReset 400 response.
 *
 * <p>See {@link InvalidCredentialsException}'s javadoc for why this lives in the root package
 * rather than {@code auth} — avoids a Spring Modulith dependency cycle.
 */
public class InvalidResetTokenException extends RuntimeException {

    public InvalidResetTokenException(String message) {
        super(message);
    }
}
