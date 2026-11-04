package io.github.tarka1939.mysite.analytics;

import java.time.LocalDate;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

import io.github.tarka1939.mysite.analytics.AnalyticsEventStore.DayTotals;
import io.github.tarka1939.mysite.analytics.AnalyticsEventStore.PageViews;
import io.github.tarka1939.mysite.analytics.AnalyticsEventStore.ProjectEventCount;
import io.github.tarka1939.mysite.analytics.AnalyticsSummary.Day;
import io.github.tarka1939.mysite.analytics.AnalyticsSummary.LinkCount;
import io.github.tarka1939.mysite.analytics.AnalyticsSummary.PageCount;
import io.github.tarka1939.mysite.analytics.AnalyticsSummary.ProjectCount;
import io.github.tarka1939.mysite.project.Link;
import io.github.tarka1939.mysite.project.ProjectService;
import io.github.tarka1939.mysite.project.ProjectTitleAndLinks;

/**
 * The admin summary (#59): counted in SQL, then completed and ordered here.
 *
 * <p>The database does the counting ({@link AnalyticsEventStore}'s three {@code GROUP BY}s), so
 * what crosses into Java is one row per day, page, or project and link with any events, never the
 * events themselves. What SQL leaves out, this fills in: days and pages with nothing, which the
 * contract lists anyway, as zeros. Projects are named through one batch call to
 * {@link ProjectService}, since the table deliberately has no foreign key to join through.
 */
@Service
@ConditionalOnAnalyticsEnabled
class AnalyticsSummaryService {

    /**
     * Most viewed first, then most clicked, then by id. The id as its canonical string, not
     * {@link UUID#compareTo}, which compares two signed longs and so disagrees with the string
     * order for ids whose leading hex digit is 8 or above. The string is what the client sees.
     */
    static final Comparator<ProjectCount> PROJECT_ORDER = Comparator
        .comparingLong(ProjectCount::views).reversed()
        .thenComparing(Comparator.comparingLong(ProjectCount::linkClicks).reversed())
        .thenComparing(project -> project.projectId().toString());

    /** Most clicked first, then by URL. */
    static final Comparator<LinkCount> LINK_ORDER = Comparator
        .comparingLong(LinkCount::clicks).reversed()
        .thenComparing(LinkCount::url);

    private final AnalyticsEventStore store;
    private final ProjectService projectService;

    AnalyticsSummaryService(AnalyticsEventStore store, ProjectService projectService) {
        this.store = store;
        this.projectService = projectService;
    }

    /**
     * One snapshot for all three queries: REPEATABLE READ, so an event inserted between them
     * cannot make a day's total disagree with the page totals by one. Read-only, so it costs
     * Postgres nothing beyond taking the snapshot once.
     *
     * @param from first day, included; the caller has already checked the range
     * @param to last day, included
     */
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public AnalyticsSummary summarize(LocalDate from, LocalDate to) {
        return new AnalyticsSummary(
            from,
            to,
            days(from, to, store.totalsByDay(from, to)),
            pages(store.viewsByPage(from, to)),
            projects(store.eventsByProject(from, to)));
    }

    private static List<Day> days(LocalDate from, LocalDate to, List<DayTotals> totals) {
        Map<LocalDate, DayTotals> byDay = totals.stream()
            .collect(Collectors.toMap(DayTotals::day, Function.identity()));
        return from.datesUntil(to.plusDays(1))
            .map(date -> {
                DayTotals day = byDay.get(date);
                return day == null
                    ? new Day(date, 0, 0, 0)
                    : new Day(date, day.views(), day.visitors(), day.linkClicks());
            })
            .toList();
    }

    private static List<PageCount> pages(List<PageViews> views) {
        Map<String, Long> byPage = views.stream()
            .collect(Collectors.toMap(PageViews::page, PageViews::views));
        return Arrays.stream(AnalyticsPage.values())
            .map(page -> new PageCount(page.wireValue(), byPage.getOrDefault(page.wireValue(), 0L)))
            .toList();
    }

    private List<ProjectCount> projects(List<ProjectEventCount> rows) {
        Map<UUID, Tally> tallies = new LinkedHashMap<>();
        for (ProjectEventCount row : rows) {
            Tally tally = tallies.computeIfAbsent(row.projectId(), id -> new Tally());
            switch (row.type()) {
                case PAGE_VIEW -> tally.views += row.events();
                case LINK_CLICK -> tally.clicksByUrl.merge(row.linkUrl(), row.events(), Long::sum);
            }
        }
        // Every project counted, published or not, deleted or not: the lookup returns what still
        // exists, and anything missing from it was deleted since.
        Map<UUID, ProjectTitleAndLinks> current = projectService.findTitlesAndLinks(tallies.keySet());

        return tallies.entrySet().stream()
            .map(entry -> projectCount(entry.getKey(), entry.getValue(), current.get(entry.getKey())))
            .sorted(PROJECT_ORDER)
            .toList();
    }

    private static ProjectCount projectCount(UUID projectId, Tally tally, ProjectTitleAndLinks project) {
        Map<String, String> labelByUrl = new HashMap<>();
        if (project != null) {
            // The first link with a URL names it, should a project list one URL twice.
            for (Link link : project.links()) {
                labelByUrl.putIfAbsent(link.url(), link.label());
            }
        }
        List<LinkCount> links = tally.clicksByUrl.entrySet().stream()
            .map(click -> new LinkCount(click.getKey(), labelByUrl.get(click.getKey()), click.getValue()))
            .sorted(LINK_ORDER)
            .toList();
        long linkClicks = links.stream().mapToLong(LinkCount::clicks).sum();
        return new ProjectCount(projectId, project == null ? null : project.title(), tally.views, linkClicks, links);
    }

    /** One project's counts while the rows are being folded together. */
    private static final class Tally {
        private long views;
        private final Map<String, Long> clicksByUrl = new HashMap<>();
    }
}
