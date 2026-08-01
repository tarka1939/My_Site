package io.github.tarka1939.mysite;

/**
 * Thrown by service layers when a requested resource doesn't exist. Caught centrally by
 * {@link GlobalExceptionHandler} and translated to a 404 ProblemDetail.
 *
 * <p>Deliberately not named {@code EntityNotFoundException} — that name collides with
 * {@code jakarta.persistence.EntityNotFoundException}, which has different semantics and
 * isn't handled by {@link GlobalExceptionHandler}; an IDE auto-importing the wrong one would
 * compile fine and fail confusingly at runtime.
 */
public class ResourceNotFoundException extends RuntimeException {

    public ResourceNotFoundException(String message) {
        super(message);
    }
}
