package io.github.tarka1939.mysite.githubsync;

import com.fasterxml.jackson.annotation.JsonValue;

/**
 * What the receiver answers GitHub with. A DTO at the controller boundary, per
 * docs/DECISIONS.md -- {@link GithubSyncRecord} never leaves this package.
 *
 * @param deliveryId echo of {@code X-GitHub-Delivery}, so a redelivery can be correlated
 * @param status whether this delivery was recorded or recognised as a replay
 */
public record GithubWebhookAck(String deliveryId, Status status) {

    /**
     * Both values are returned with 202. GitHub's retry logic only reads the status code, and
     * from its side "recorded" and "already had it" both mean <i>received, stop retrying</i>;
     * splitting them across two status codes would say nothing to GitHub and cost the contract
     * a case. The distinction is for whoever is reading the response by hand while diagnosing a
     * webhook, which is exactly when it matters.
     */
    public enum Status {
        RECORDED("recorded"),
        DUPLICATE("duplicate");

        private final String wireValue;

        Status(String wireValue) {
            this.wireValue = wireValue;
        }

        /**
         * The contract (docs/openapi.yaml, GithubWebhookAck) spells these lowercase, and an
         * enum would otherwise serialise as its SCREAMING_CASE name. Asserted on the actual
         * response body in {@code GithubWebhookIntegrationTest}, not just here.
         */
        @JsonValue
        public String wireValue() {
            return wireValue;
        }
    }
}
