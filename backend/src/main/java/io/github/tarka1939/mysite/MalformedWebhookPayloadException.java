package io.github.tarka1939.mysite;

/**
 * Thrown when an inbound webhook delivery passes signature verification but cannot be processed
 * -- a required header absent, a value too long for the column that records it, or a body that
 * is not a JSON object. Caught centrally by {@link GlobalExceptionHandler} and translated to a
 * 400 ProblemDetail.
 *
 * <p>Unlike {@link InvalidWebhookSignatureException} this one does echo its message, because by
 * the time it can be thrown the caller has already proved it holds the shared secret -- it is
 * GitHub, or someone who could forge a delivery anyway, and telling it what was wrong is how a
 * misconfigured webhook gets diagnosed.
 *
 * <p>Root package, not {@code githubsync} -- see {@link InvalidCredentialsException}.
 */
public class MalformedWebhookPayloadException extends RuntimeException {

    public MalformedWebhookPayloadException(String message) {
        super(message);
    }
}
