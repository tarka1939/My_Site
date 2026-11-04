package io.github.tarka1939.mysite.analytics;

import java.util.UUID;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * Body of {@code POST /analytics/link-clicks}: docs/openapi.yaml's LinkClickEvent (named a request
 * here for {@link PageViewRequest}'s reason).
 *
 * <p>{@code url} is {@code @Size(min = 1)}, the contract's {@code minLength: 1}, rather than
 * {@code @NotBlank}. A blank URL is well-formed by the contract and can never match one of a
 * project's links, so it is dropped with 204 like any other URL the project does not have.
 *
 * @param projectId the project whose link was followed
 * @param url the link's URL, compared exactly against the project's current links
 */
public record LinkClickRequest(
    @NotNull UUID projectId,
    @NotNull @Size(min = 1, max = 500) String url
) {
}
