package io.github.tarka1939.mysite;

/**
 * Thrown when an inbound webhook body exceeds the receiver's cap. Caught centrally by
 * {@link GlobalExceptionHandler} and translated to a 413 ProblemDetail.
 *
 * <p>This one is checked <i>before</i> signature verification, which is the opposite of the
 * order everything else uses, and on purpose: the endpoint is unauthenticated, so the bytes
 * have to be read before anyone can be identified, and reading an unbounded body into memory to
 * find out whether it was worth reading is the whole problem. Nothing is recorded and no
 * payload is parsed on this path.
 *
 * <p>Root package, not {@code githubsync} -- see {@link InvalidCredentialsException}.
 */
public class WebhookPayloadTooLargeException extends RuntimeException {

    public WebhookPayloadTooLargeException(String message) {
        super(message);
    }
}
