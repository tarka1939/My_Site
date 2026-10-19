package io.github.tarka1939.mysite.project;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import io.github.tarka1939.mysite.TestPostgres;

import io.github.tarka1939.mysite.PageResponse;

import jakarta.persistence.EntityManager;

/**
 * The public project order (#88), against real Postgres: {@link ProjectRepository#PUBLIC_ORDER}
 * through {@link ProjectService#listPublishedProjects}, which is everything GET /projects runs
 * below the controller.
 *
 * <p>Real Postgres rather than anything that could stand in for it, because the risks here are
 * Postgres's: where it puts NULLs under DESC, and that LIMIT/OFFSET over rows that tie on every
 * sort key may return them in a different order for each page.
 *
 * <p>One fixture, set out in {@link #EXPECTED}, holds every group in both halves: featured and
 * not, each with ongoing, completed and undated projects, plus a tie on each tie-breaker and a
 * draft that must not appear. {@code created_at} is set by hand, mostly in the <i>opposite</i>
 * order to the expected one - so the order this replaced, newest entry first, would come out
 * close to backwards - and with exact ties where a tie is what is being tested.
 *
 * <p>{@code @Transactional}, so each test rolls back; the container is this class's own, so
 * nothing but the fixture is in the table, which {@link #setUp} checks.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.NONE)
@Testcontainers
@ActiveProfiles("test")
@Transactional
class ProjectPublicOrderIntegrationTest {

    @Container
    @ServiceConnection
    static PostgreSQLContainer postgres = TestPostgres.container();

    private static final String TAG = "order-88";
    private static final String OTHER_TAG = "order-88-other";
    private static final String FILTER_ONLY_TAG = "order-88-filter";

    /**
     * Every published project in the fixture, in the order GET /projects must list them. The
     * comment on each says which rule puts it there.
     */
    private static final List<String> EXPECTED = List.of(
        // -- featured, whatever its dates: featured outranks every period group.
        "F ongoing",                 // featured, ongoing
        "F completed 2024-06",       // featured, completed, later completion first
        "F completed 2021-01",       // featured, completed
        "F undated",                 // featured, no dates: last of the featured, before the rest
        // -- not featured: ongoing, latest start first.
        "ongoing from 2025-06",
        "ongoing from 2024-01, newer entry", // ties on start; newer created_at first
        "ongoing from 2024-01, older entry",
        // -- not featured: completed, latest completion first.
        "completed 2025-03",
        "completed 2024-12, started 2024-02", // ties on completion; later start first
        "completed 2024-12, started 2023-05",
        "completed 2019-06",
        // -- not featured: no dates, newest entry first.
        "undated, newer entry",
        "undated, older entry",
        "undated twin, lower id",    // ties on every key but the id
        "undated twin, higher id");

    @Autowired
    private ProjectService projectService;

    @Autowired
    private EntityManager entityManager;

    /** Title to id, for the published fixture; the twins' titles are assigned by id below. */
    private final Map<String, UUID> ids = new LinkedHashMap<>();

    @BeforeEach
    void setUp() {
        assertThat(projectService.listPublishedProjects(PageRequest.of(0, 100), List.of())
            .content())
            .as("precondition: this class's database holds nothing but the fixture")
            .isEmpty();

        int day = 1;
        create("F ongoing", true, LocalDate.of(2023, 1, 1), null, day++);
        create("F completed 2024-06", true,
            LocalDate.of(2022, 1, 1), LocalDate.of(2024, 6, 1), day++);
        create("F completed 2021-01", true,
            LocalDate.of(2020, 1, 1), LocalDate.of(2021, 1, 1), day++);
        create("F undated", true, null, null, day++);

        create("ongoing from 2025-06", false, LocalDate.of(2025, 6, 1), null, day++);
        // Same start; the created_at tie-break decides, so the newer entry gets the later day.
        create("ongoing from 2024-01, older entry", false, LocalDate.of(2024, 1, 1), null, day++);
        create("ongoing from 2024-01, newer entry", false, LocalDate.of(2024, 1, 1), null, day++);

        create("completed 2025-03", false,
            LocalDate.of(2023, 1, 1), LocalDate.of(2025, 3, 1), day++);
        create("completed 2024-12, started 2024-02", false,
            LocalDate.of(2024, 2, 1), LocalDate.of(2024, 12, 1), day++);
        create("completed 2024-12, started 2023-05", false,
            LocalDate.of(2023, 5, 1), LocalDate.of(2024, 12, 1), day++);
        create("completed 2019-06", false,
            LocalDate.of(2019, 1, 1), LocalDate.of(2019, 6, 1), day++);

        // The newest entries of all, as a draft just made from a GitHub repository would be:
        // first under the old order, last under this one.
        create("undated, older entry", false, null, null, day++);
        create("undated, newer entry", false, null, null, day++);

        // Identical on every key but the id. The twin with the higher id is written to the heap
        // first (setCreatedAt updates the row, which moves it), so that a sort with no id key,
        // returning ties in the order it reads them, disagrees with the expected order.
        UUID a = create("twin a", false, null, null, 0);
        UUID b = create("twin b", false, null, null, 0);
        UUID lower = idOrder().compare(a, b) < 0 ? a : b;
        UUID higher = lower.equals(a) ? b : a;
        setCreatedAt(higher, 0);
        setCreatedAt(lower, 0);
        ids.remove("twin a");
        ids.remove("twin b");
        ids.put("undated twin, lower id", lower);
        ids.put("undated twin, higher id", higher);

        // A draft that would sort first on every key if drafts were listed.
        UUID draft = projectService.createProject(new ProjectWriteRequest(
            "draft", "Never public", List.of(), List.of(), List.of(TAG),
            LocalDate.of(2026, 1, 1), null, false, true, null)).id();
        setCreatedAt(draft, day);

        entityManager.flush();
        entityManager.clear();
    }

    @Test
    void theUnfilteredListFollowsTheOrderTheOwnerDecided() {
        List<String> titles = titles(projectService.listPublishedProjects(
            PageRequest.of(0, 100), List.of()));

        assertThat(titles).containsExactlyElementsOf(EXPECTED);
    }

    /**
     * Same order through the tag-filtered query, which carries its own copy of the WHERE clause
     * and must not carry its own order. Filtered by two tags so that a project holding both is
     * matched twice by the subquery and must still be listed once.
     */
    @Test
    void theTagFilteredListFollowsTheSameOrder() {
        List<String> titles = titles(projectService.listPublishedProjects(
            PageRequest.of(0, 100), List.of(OTHER_TAG, FILTER_ONLY_TAG)));

        assertThat(titles).containsExactly(
            "F ongoing",
            "F completed 2021-01",
            "F undated",
            "ongoing from 2024-01, newer entry",
            "completed 2024-12, started 2023-05",
            "undated, older entry",
            "undated twin, lower id",
            "undated twin, higher id");
    }

    /** Pages of the filtered list, too: the id key has to be in that query's order as well. */
    @Test
    void theTagFilteredListPagesWithoutRepeatsOrGaps() {
        List<String> whole = titles(projectService.listPublishedProjects(
            PageRequest.of(0, 100), List.of(OTHER_TAG, FILTER_ONLY_TAG)));

        for (int size = 1; size <= whole.size(); size++) {
            List<String> all = new ArrayList<>();
            for (int page = 0; page * size < whole.size(); page++) {
                all.addAll(titles(projectService.listPublishedProjects(
                    PageRequest.of(page, size), List.of(OTHER_TAG, FILTER_ONLY_TAG))));
            }
            assertThat(all).as("page size %d", size).containsExactlyElementsOf(whole);
        }
    }

    /**
     * Paging is stable: page 0 and page 1 together list each project once and in order. Seven a
     * page puts that boundary between the ongoing and the completed groups, and page 1 then ends
     * on the first of the two twins, so page 2 has to start on the second one.
     */
    @Test
    void pageZeroAndPageOneListEachProjectExactlyOnce_inOrder() {
        List<String> page0 = titles(projectService.listPublishedProjects(
            PageRequest.of(0, 7), List.of()));
        List<String> page1 = titles(projectService.listPublishedProjects(
            PageRequest.of(1, 7), List.of()));
        List<String> page2 = titles(projectService.listPublishedProjects(
            PageRequest.of(2, 7), List.of()));

        assertThat(page0).containsExactlyElementsOf(EXPECTED.subList(0, 7));
        assertThat(page1).containsExactlyElementsOf(EXPECTED.subList(7, 14));
        assertThat(page2).containsExactlyElementsOf(EXPECTED.subList(14, 15));
    }

    /**
     * Every page size, so that a boundary falls inside every tie the fixture has: on each one,
     * the pages laid end to end must be the whole order, with nothing repeated or missed. This is
     * what the id key buys, and what a non-total order loses one page size at a time.
     */
    @Test
    void atEveryPageSize_thePagesLaidEndToEndAreTheWholeOrder() {
        for (int size = 1; size <= EXPECTED.size(); size++) {
            List<String> all = new ArrayList<>();
            for (int page = 0; page * size < EXPECTED.size(); page++) {
                all.addAll(titles(projectService.listPublishedProjects(
                    PageRequest.of(page, size), List.of())));
            }
            assertThat(all).as("page size %d", size).containsExactlyElementsOf(EXPECTED);
        }
    }

    /**
     * A caller's Sort is not obeyed. Newest entry first is the order this replaced, and the one a
     * caller is most likely to pass by habit.
     *
     * <p>This test cannot tell a dropped Sort from an appended one: PUBLIC_ORDER already ends on
     * the unique id, so any key Spring Data appended after it would change nothing. That the
     * service drops it is pinned by ProjectServiceTest's
     * listPublishedProjects_dropsTheCallersSort_keepingPageAndSize, so do not delete that test on
     * the strength of this one.
     */
    @Test
    void aSortPassedInIsIgnored() {
        List<String> titles = titles(projectService.listPublishedProjects(
            PageRequest.of(0, 100, Sort.by(Sort.Direction.DESC, "createdAt")), List.of()));

        assertThat(titles).containsExactlyElementsOf(EXPECTED);
    }

    /**
     * The admin list is not reordered (#88): newest entry first, featured or not, drafts
     * included. Called with the Sort AdminProjectController builds, which the service must pass
     * through for this list where it drops it for the public one.
     */
    @Test
    void theAdminListKeepsNewestEnteredFirst() {
        List<String> titles = titles(projectService.listAllProjects(
            PageRequest.of(0, 100, Sort.by(Sort.Direction.DESC, "createdAt")), List.of()));

        assertThat(titles.subList(0, 14)).containsExactly(
            "draft",
            "undated, newer entry",
            "undated, older entry",
            "completed 2019-06",
            "completed 2024-12, started 2023-05",
            "completed 2024-12, started 2024-02",
            "completed 2025-03",
            "ongoing from 2024-01, newer entry",
            "ongoing from 2024-01, older entry",
            "ongoing from 2025-06",
            "F undated",
            "F completed 2021-01",
            "F completed 2024-06",
            "F ongoing");
        // The admin order has no id key, so the twins' order between themselves is not pinned.
        assertThat(titles.subList(14, titles.size()))
            .containsExactlyInAnyOrder("undated twin, lower id", "undated twin, higher id");
    }

    // -------------------------------------------------------------------------------------
    // Fixture.
    // -------------------------------------------------------------------------------------

    /**
     * The projects that carry a tag the filtered tests ask for; the rest carry only TAG. One of
     * each group, both halves, and both twins, so the filtered order is tested as fully as the
     * unfiltered one.
     */
    private static final List<String> TAGGED_FOR_FILTER = List.of(
        "F ongoing",
        "F completed 2021-01",
        "F undated",
        "ongoing from 2024-01, newer entry",
        "completed 2024-12, started 2023-05",
        "undated, older entry",
        "twin a",
        "twin b");

    private UUID create(
        String title, boolean featured, LocalDate startedOn, LocalDate completedOn, int day
    ) {
        List<String> tags = new ArrayList<>(List.of(TAG));
        if (TAGGED_FOR_FILTER.contains(title)) {
            // Both filter tags on some, one on others: a project matching both must still be
            // listed once.
            tags.add(OTHER_TAG);
            if (title.startsWith("F ") || title.startsWith("twin")) {
                tags.add(FILTER_ONLY_TAG);
            }
        }
        UUID id = projectService.createProject(new ProjectWriteRequest(
            title, "Fixture for " + getClass().getSimpleName(), List.of(), List.of(), tags,
            startedOn, completedOn, true, featured, null)).id();
        setCreatedAt(id, day);
        ids.put(title, id);
        return id;
    }

    /**
     * Sets created_at directly. @CreationTimestamp takes the JVM clock at flush, so two inserts
     * in one test can land on the same microsecond or not, and a tie-break test cannot depend
     * on which.
     */
    private void setCreatedAt(UUID id, int day) {
        entityManager.flush();
        entityManager.createNativeQuery("UPDATE project SET created_at = :at WHERE id = :id")
            .setParameter("at", Instant.parse("2026-01-01T00:00:00Z").plusSeconds(86_400L * day))
            .setParameter("id", id)
            .executeUpdate();
    }

    /**
     * Postgres compares uuid values byte by byte. {@link UUID#compareTo} compares two signed
     * longs, which disagrees whenever a leading bit is set; the canonical lowercase hex string
     * compares the same way Postgres does.
     */
    private static Comparator<UUID> idOrder() {
        return Comparator.comparing(UUID::toString);
    }

    private List<String> titles(PageResponse<ProjectResponse> page) {
        Map<UUID, String> twinTitles = Map.of(
            ids.get("undated twin, lower id"), "undated twin, lower id",
            ids.get("undated twin, higher id"), "undated twin, higher id");
        return page.content().stream()
            .map(project -> twinTitles.getOrDefault(project.id(), project.title()))
            .toList();
    }
}
