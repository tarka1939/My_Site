package io.github.tarka1939.mysite.analytics;

import java.util.Optional;

/**
 * The closed list of public pages an event can name, in docs/openapi.yaml's AnalyticsPage order,
 * which is also the order of the dashboard's {@code pages} list. The password-reset, admin and
 * not-found pages are absent on purpose and are never counted. The database holds the same list in
 * {@code ck_analytics_event_page} (V9).
 */
enum AnalyticsPage {

    ABOUT("about"),
    PROJECTS("projects"),
    PROJECT("project"),
    CONTACT("contact"),
    PRIVACY("privacy");

    /**
     * The same list as a regex, for {@code @Pattern} on {@link PageViewRequest#page()}, which needs
     * a compile-time constant and so cannot be built from {@link #values()}. Two copies of one list
     * is the drift this project keeps paying for, so {@code AnalyticsPageTest} fails if they ever
     * disagree.
     */
    static final String WIRE_PATTERN = "about|projects|project|contact|privacy";

    private final String wireValue;

    AnalyticsPage(String wireValue) {
        this.wireValue = wireValue;
    }

    /** The value on the wire and in {@code analytics_event.page}. */
    String wireValue() {
        return wireValue;
    }

    static Optional<AnalyticsPage> fromWire(String value) {
        for (AnalyticsPage page : values()) {
            if (page.wireValue.equals(value)) {
                return Optional.of(page);
            }
        }
        return Optional.empty();
    }
}
