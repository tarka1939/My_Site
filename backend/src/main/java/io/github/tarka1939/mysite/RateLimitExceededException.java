package io.github.tarka1939.mysite;

/**
 * Thrown when a per-requester rate limit is exceeded. Caught centrally by
 * {@link GlobalExceptionHandler} and translated to a 429 ProblemDetail.
 */
public class RateLimitExceededException extends RuntimeException {

    public RateLimitExceededException(String message) {
        super(message);
    }
}
