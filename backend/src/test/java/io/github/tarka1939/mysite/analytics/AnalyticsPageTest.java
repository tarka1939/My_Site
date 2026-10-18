package io.github.tarka1939.mysite.analytics;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Arrays;
import java.util.List;

import org.junit.jupiter.api.Test;

class AnalyticsPageTest {

    /** The regex copy of the list must be the enum's list, in the enum's order. */
    @Test
    void wirePatternIsExactlyTheEnumsWireValues() {
        List<String> fromEnum = Arrays.stream(AnalyticsPage.values()).map(AnalyticsPage::wireValue).toList();

        assertThat(List.of(AnalyticsPage.WIRE_PATTERN.split("\\|"))).isEqualTo(fromEnum);
    }

    /** docs/openapi.yaml's AnalyticsPage enum and V9's ck_analytics_event_page, in that order. */
    @Test
    void theListIsTheContractsList() {
        assertThat(Arrays.stream(AnalyticsPage.values()).map(AnalyticsPage::wireValue))
            .containsExactly("about", "projects", "project", "contact", "privacy");
    }

    @Test
    void fromWireIsExactAndCaseSensitive() {
        assertThat(AnalyticsPage.fromWire("project")).contains(AnalyticsPage.PROJECT);
        assertThat(AnalyticsPage.fromWire("Project")).isEmpty();
        assertThat(AnalyticsPage.fromWire("projects ")).isEmpty();
        assertThat(AnalyticsPage.fromWire(null)).isEmpty();
    }
}
