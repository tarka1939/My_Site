package io.github.tarka1939.mysite;

/**
 * Thrown by service layers when a requested entity doesn't exist. Caught centrally by
 * {@link GlobalExceptionHandler} and translated to a 404 ProblemDetail.
 */
public class EntityNotFoundException extends RuntimeException {

    public EntityNotFoundException(String message) {
        super(message);
    }
}
