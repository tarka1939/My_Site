package io.github.tarka1939.mysite.analytics;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * {@code GET /api/v1/admin/analytics}'s body (#59): docs/openapi.yaml's {@code AnalyticsSummary}
 * and the four schemas under it, nested here because nothing else uses them.
 *
 * <p>Every list is complete and ordered as the contract states before it reaches here (see
 * {@link AnalyticsSummaryService}), so the client does no filling in or sorting of its own.
 *
 * @param from first day of the range, included, after defaults
 * @param to last day of the range, included, after defaults
 * @param days one per day of the range, oldest first, zero days included
 * @param pages one per {@link AnalyticsPage}, in its order, zero pages included
 * @param projects every project with a view or a link click in the range
 */
public record AnalyticsSummary(
    LocalDate from,
    LocalDate to,
    List<Day> days,
    List<PageCount> pages,
    List<ProjectCount> projects
) {

    public AnalyticsSummary {
        days = List.copyOf(days);
        pages = List.copyOf(pages);
        projects = List.copyOf(projects);
    }

    /** {@code AnalyticsDay}. {@code visitors} is distinct visitors that day, across everything. */
    public record Day(LocalDate date, long views, long visitors, long linkClicks) {
    }

    /** {@code AnalyticsPageCount}; {@code page} is the wire value, such as {@code about}. */
    public record PageCount(String page, long views) {
    }

    /**
     * {@code AnalyticsProjectCount}.
     *
     * @param title the project's title now, or null if it has been deleted; an unpublished project
     *     keeps its title
     */
    public record ProjectCount(UUID projectId, String title, long views, long linkClicks, List<LinkCount> links) {

        public ProjectCount {
            links = List.copyOf(links);
        }
    }

    /**
     * {@code AnalyticsLinkCount}.
     *
     * @param label the label the project gives this URL now, or null if it no longer has the link
     *     or no longer exists
     */
    public record LinkCount(String url, String label, long clicks) {
    }
}
