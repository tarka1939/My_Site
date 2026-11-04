package io.github.tarka1939.mysite.analytics;

/** The two things counted, as stored in {@code analytics_event.event_type} ({@code ck_analytics_event_event_type}, V9). */
enum AnalyticsEventType {

    PAGE_VIEW("page_view"),
    LINK_CLICK("link_click");

    private final String columnValue;

    AnalyticsEventType(String columnValue) {
        this.columnValue = columnValue;
    }

    String columnValue() {
        return columnValue;
    }

    static AnalyticsEventType fromColumn(String value) {
        for (AnalyticsEventType type : values()) {
            if (type.columnValue.equals(value)) {
                return type;
            }
        }
        throw new IllegalStateException("analytics_event.event_type outside its CHECK: " + value);
    }
}
