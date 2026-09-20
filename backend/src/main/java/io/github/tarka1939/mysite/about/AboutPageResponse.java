package io.github.tarka1939.mysite.about;

import java.time.Instant;

/** The wire shape of the About page -- see {@code AboutPage} in docs/openapi.yaml. */
public record AboutPageResponse(String body, Instant updatedAt) {

    static AboutPageResponse from(AboutPage page) {
        return new AboutPageResponse(page.getBody(), page.getUpdatedAt());
    }
}
