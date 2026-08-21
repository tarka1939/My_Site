package io.github.tarka1939.mysite;

/**
 * Thrown when an inbound webhook delivery's signature is missing, malformed, or does not match
 * the raw request body. Caught centrally by {@link GlobalExceptionHandler} and translated to a
 * 401 ProblemDetail.
 *
 * <p>Deliberately carries no detail about <i>which</i> of those it was, and the handler sends a
 * fixed message: an unauthenticated caller probing the endpoint learns nothing from the
 * response about how close a guess was. Same reasoning as
 * {@link InvalidCredentialsException}'s refusal to distinguish unknown-user from wrong-password.
 *
 * <p>Lives in the root package rather than {@code githubsync}, for the reason spelled out on
 * {@link InvalidCredentialsException}: modules throw, only the root's handler catches, and
 * putting it in the module creates a Spring Modulith cycle.
 */
public class InvalidWebhookSignatureException extends RuntimeException {

    public InvalidWebhookSignatureException() {
        super("Webhook signature verification failed");
    }
}
