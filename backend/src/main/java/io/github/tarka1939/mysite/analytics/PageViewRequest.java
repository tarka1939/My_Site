package io.github.tarka1939.mysite.analytics;

import java.util.UUID;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;

/**
 * Body of {@code POST /analytics/page-views}: docs/openapi.yaml's PageViewEvent. Named a request
 * rather than an event here because "Event" in this codebase means a Spring application event
 * ({@code ProjectCreatedEvent}).
 *
 * <p>{@code page} is a String checked against the closed list rather than an {@link AnalyticsPage}
 * bound by Jackson. A value off the list then fails Bean Validation, and the 400 carries a field
 * error on {@code page} like every other validation failure; bound as an enum it would fail
 * deserialization instead, as a plain 400 with no {@code errors}.
 *
 * <p>The rule between the two fields is {@link ProjectIdMatchesPage}'s: a field error keyed
 * {@code projectId} either way.
 *
 * @param page one of the AnalyticsPage values
 * @param projectId the project whose page was shown; required when {@code page} is
 *     {@code project} and refused otherwise
 */
@ProjectIdMatchesPage
public record PageViewRequest(
    @NotNull
    @Pattern(regexp = AnalyticsPage.WIRE_PATTERN, message = "must be one of about, projects, project, contact, privacy")
    String page,
    UUID projectId
) {

    /** The page as the enum. Only meaningful once the request has passed validation. */
    AnalyticsPage analyticsPage() {
        return AnalyticsPage.fromWire(page)
            .orElseThrow(() -> new IllegalStateException("page was not validated against the closed list"));
    }
}
