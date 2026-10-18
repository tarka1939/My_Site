package io.github.tarka1939.mysite.analytics;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.lang.reflect.Method;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Stream;

import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

import io.github.tarka1939.mysite.TestPostgres;
import io.github.tarka1939.mysite.analytics.AnalyticsSummary.Day;
import io.github.tarka1939.mysite.analytics.AnalyticsSummary.LinkCount;
import io.github.tarka1939.mysite.analytics.AnalyticsSummary.PageCount;
import io.github.tarka1939.mysite.analytics.AnalyticsSummary.ProjectCount;
import io.github.tarka1939.mysite.auth.AdminUserRepository;
import io.github.tarka1939.mysite.project.Link;
import io.github.tarka1939.mysite.project.Project;
import io.github.tarka1939.mysite.project.ProjectRepository;

import tools.jackson.databind.ObjectMapper;

/**
 * {@code GET /api/v1/admin/analytics} (#59) against real Postgres.
 *
 * <p>The events are written straight through {@link AnalyticsEventStore} on fixed past days, so
 * every count below is worked out by hand from {@link #seed()} and none depends on today. Only the
 * defaults tests read today, and they accept either side of a midnight that falls mid-request.
 */
@SpringBootTest(properties = "app.analytics.enabled=true")
@AutoConfigureMockMvc
@Testcontainers
@ActiveProfiles("test")
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class AdminAnalyticsIntegrationTest {

    private static final String SUMMARY = "/api/v1/admin/analytics";

    private static final String DATE_OUT_OF_RANGE = "must be a date from 0001-01-01 to 9999-12-31";

    private static final String H1 = "1".repeat(64);
    private static final String H2 = "2".repeat(64);
    private static final String H3 = "3".repeat(64);
    private static final String H4 = "4".repeat(64);

    private static final String ALPHA_GITHUB = "https://github.com/tarka1939/Alpha";
    private static final String ALPHA_DEMO = "https://example.com/alpha";
    /** Clicked while Alpha had it; Alpha no longer does. */
    private static final String ALPHA_REMOVED = "https://example.com/old-alpha";
    private static final String BRAVO_SITE = "https://example.com/bravo";
    private static final String DELTA_SITE = "https://example.com/delta";
    private static final String ECHO_SITE = "https://example.com/echo";
    private static final String FOXTROT_SITE = "https://example.com/foxtrot";

    private static final LocalDate FROM = LocalDate.of(2026, 3, 1);
    private static final LocalDate TO = LocalDate.of(2026, 3, 7);

    @Container
    @ServiceConnection
    static PostgreSQLContainer postgres = TestPostgres.container();

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private AnalyticsEventStore store;

    @Autowired
    private ProjectRepository projectRepository;

    @Autowired
    private AdminUserRepository adminUserRepository;

    @Autowired
    private PasswordEncoder passwordEncoder;

    @Autowired
    private ObjectMapper objectMapper;

    private String adminToken;
    private UUID alpha;
    private UUID bravo;
    private UUID charlie;
    private UUID delta;
    private UUID echo;
    private UUID foxtrot;

    @BeforeAll
    void seed() throws Exception {
        alpha = saveProject("Alpha", true, List.of(new Link("GitHub", ALPHA_GITHUB), new Link("Demo", ALPHA_DEMO)));
        bravo = saveProject("Bravo", true, List.of(new Link("Site", BRAVO_SITE)));
        // Unpublished since its view: keeps its title on the dashboard.
        charlie = saveProject("Charlie", false, List.of());
        // Deleted since its events: a null title, and a null label on its link.
        delta = saveProject("Delta", true, List.of(new Link("Site", DELTA_SITE)));
        echo = saveProject("Echo", true, List.of(new Link("Echo site", ECHO_SITE)));
        foxtrot = saveProject("Foxtrot", true, List.of(new Link("Foxtrot site", FOXTROT_SITE)));

        LocalDate mar2 = LocalDate.of(2026, 3, 2);
        view(H1, AnalyticsPage.ABOUT, null, mar2);
        view(H1, AnalyticsPage.PROJECTS, null, mar2);
        view(H2, AnalyticsPage.ABOUT, null, mar2);
        view(H1, AnalyticsPage.PROJECT, alpha, mar2);
        view(H2, AnalyticsPage.PROJECT, alpha, mar2);
        view(H3, AnalyticsPage.PROJECT, alpha, mar2);
        click(H1, alpha, ALPHA_GITHUB, mar2);
        click(H2, alpha, ALPHA_GITHUB, mar2);
        click(H1, alpha, ALPHA_DEMO, mar2);
        click(H1, alpha, ALPHA_REMOVED, mar2);

        LocalDate mar4 = LocalDate.of(2026, 3, 4);
        view(H1, AnalyticsPage.PROJECT, alpha, mar4);
        view(H4, AnalyticsPage.CONTACT, null, mar4);
        view(H1, AnalyticsPage.PROJECT, charlie, mar4);
        view(H2, AnalyticsPage.PROJECT, delta, mar4);
        click(H2, delta, DELTA_SITE, mar4);
        view(H3, AnalyticsPage.PROJECT, bravo, mar4);
        click(H3, bravo, BRAVO_SITE, mar4);
        click(H4, bravo, BRAVO_SITE, mar4);

        // Echo and Foxtrot tie exactly, so only the id can order them.
        LocalDate mar6 = LocalDate.of(2026, 3, 6);
        click(H1, echo, ECHO_SITE, mar6);
        click(H2, foxtrot, FOXTROT_SITE, mar6);

        // Just outside the range, on both sides.
        view(H1, AnalyticsPage.ABOUT, null, LocalDate.of(2026, 2, 28));
        view(H1, AnalyticsPage.PRIVACY, null, LocalDate.of(2026, 3, 8));

        projectRepository.deleteById(delta);
        projectRepository.flush();

        AnalyticsTestSupport.seedAdmin(adminUserRepository, passwordEncoder, "analytics-summary-admin");
        MockHttpServletResponse login = mockMvc.perform(post("/api/v1/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content(AnalyticsTestSupport.loginJson("analytics-summary-admin"))
                .with(request -> {
                    request.setRemoteAddr("203.0.113.240");
                    return request;
                }))
            .andExpect(status().isOk())
            .andReturn().getResponse();
        adminToken = (String) objectMapper.readValue(login.getContentAsString(), Map.class).get("token");
    }

    @Test
    void withNoToken_is401() throws Exception {
        mockMvc.perform(get(SUMMARY)).andExpect(status().isUnauthorized());
    }

    /** Every number below is worked out by hand from seed(). */
    @Test
    void theAdminGetsTheWholeSummary_countedFilledAndOrdered() throws Exception {
        AnalyticsSummary summary = summary(FROM, TO);

        assertThat(summary.from()).isEqualTo(FROM);
        assertThat(summary.to()).isEqualTo(TO);
        assertThat(summary.days()).containsExactly(
            new Day(LocalDate.of(2026, 3, 1), 0, 0, 0),
            new Day(LocalDate.of(2026, 3, 2), 6, 3, 4),
            new Day(LocalDate.of(2026, 3, 3), 0, 0, 0),
            new Day(LocalDate.of(2026, 3, 4), 5, 4, 3),
            new Day(LocalDate.of(2026, 3, 5), 0, 0, 0),
            new Day(LocalDate.of(2026, 3, 6), 0, 2, 2),
            new Day(LocalDate.of(2026, 3, 7), 0, 0, 0));
        assertThat(summary.pages()).containsExactly(
            new PageCount("about", 2),
            new PageCount("projects", 1),
            new PageCount("project", 7),
            new PageCount("contact", 1),
            new PageCount("privacy", 0));

        List<ProjectCount> tiedOnEverything = Stream.of(
                new ProjectCount(echo, "Echo", 0, 1, List.of(new LinkCount(ECHO_SITE, "Echo site", 1))),
                new ProjectCount(foxtrot, "Foxtrot", 0, 1, List.of(new LinkCount(FOXTROT_SITE, "Foxtrot site", 1))))
            .sorted(Comparator.comparing(project -> project.projectId().toString()))
            .toList();
        List<ProjectCount> expected = new ArrayList<>(List.of(
            new ProjectCount(alpha, "Alpha", 4, 4, List.of(
                new LinkCount(ALPHA_GITHUB, "GitHub", 2),
                // Tied on clicks, so by URL; the removed link keeps its count and loses its label.
                new LinkCount(ALPHA_DEMO, "Demo", 1),
                new LinkCount(ALPHA_REMOVED, null, 1))),
            // Bravo, Delta and Charlie tie on views, so most clicked first.
            new ProjectCount(bravo, "Bravo", 1, 2, List.of(new LinkCount(BRAVO_SITE, "Site", 2))),
            new ProjectCount(delta, null, 1, 1, List.of(new LinkCount(DELTA_SITE, null, 1))),
            new ProjectCount(charlie, "Charlie", 1, 0, List.of())));
        expected.addAll(tiedOnEverything);
        assertThat(summary.projects()).containsExactlyElementsOf(expected);
    }

    /** The contract requires title and label even when null: present, as JSON null. */
    @Test
    void nullTitlesAndLabelsAreSentAsNull_notLeftOut() throws Exception {
        Map<String, Object> body = objectMapper.readValue(
            perform(get(SUMMARY).param("from", FROM.toString()).param("to", TO.toString())).getContentAsString(), Map.class);

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> projects = (List<Map<String, Object>>) body.get("projects");
        Map<String, Object> deleted = projects.stream()
            .filter(project -> delta.toString().equals(project.get("projectId")))
            .findFirst().orElseThrow();
        assertThat(deleted).containsEntry("title", null).containsKeys("views", "linkClicks", "links");
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> links = (List<Map<String, Object>>) deleted.get("links");
        assertThat(links).singleElement().satisfies(link -> assertThat(link).containsEntry("label", null));
        assertThat(body.get("from")).isEqualTo("2026-03-01");
        assertThat(((List<?>) body.get("days")).getFirst()).isEqualTo(
            Map.of("date", "2026-03-01", "views", 0, "visitors", 0, "linkClicks", 0));
    }

    @Test
    void aRangeWithNoEvents_isAllZeros_withEveryDayAndPage() throws Exception {
        AnalyticsSummary summary = summary(LocalDate.of(2025, 1, 1), LocalDate.of(2025, 1, 3));

        assertThat(summary.days()).extracting(Day::date)
            .containsExactly(LocalDate.of(2025, 1, 1), LocalDate.of(2025, 1, 2), LocalDate.of(2025, 1, 3));
        assertThat(summary.days()).allSatisfy(day -> assertThat(day.views() + day.visitors() + day.linkClicks()).isZero());
        assertThat(summary.pages()).extracting(PageCount::page)
            .containsExactly("about", "projects", "project", "contact", "privacy");
        assertThat(summary.pages()).extracting(PageCount::views).containsOnly(0L);
        assertThat(summary.projects()).isEmpty();
    }

    @Test
    void aOneDayRange_isOneDay() throws Exception {
        LocalDate mar2 = LocalDate.of(2026, 3, 2);

        assertThat(summary(mar2, mar2).days()).containsExactly(new Day(mar2, 6, 3, 4));
    }

    @Test
    void withNoParameters_theRangeIsThe30DaysEndingToday() throws Exception {
        LocalDate before = LocalDate.now(ZoneOffset.UTC);
        AnalyticsSummary summary = read(perform(get(SUMMARY)));
        LocalDate after = LocalDate.now(ZoneOffset.UTC);

        assertThat(summary.to()).isBetween(before, after);
        assertThat(summary.from()).isEqualTo(summary.to().minusDays(29));
        assertThat(summary.days()).hasSize(30);
        assertThat(summary.days().getLast().date()).isEqualTo(summary.to());
    }

    @Test
    void withOnlyTo_fromIs29DaysBeforeIt() throws Exception {
        AnalyticsSummary summary = read(perform(get(SUMMARY).param("to", TO.toString())));

        assertThat(summary.from()).isEqualTo(LocalDate.of(2026, 2, 6));
        assertThat(summary.to()).isEqualTo(TO);
        assertThat(summary.days()).hasSize(30);
    }

    @Test
    void withOnlyFrom_toIsToday() throws Exception {
        LocalDate before = LocalDate.now(ZoneOffset.UTC);
        LocalDate from = before.minusDays(10);
        AnalyticsSummary summary = read(perform(get(SUMMARY).param("from", from.toString())));
        LocalDate after = LocalDate.now(ZoneOffset.UTC);

        assertThat(summary.from()).isEqualTo(from);
        assertThat(summary.to()).isBetween(before, after);
    }

    @Test
    void toBeforeFrom_isAFieldErrorOnTo() throws Exception {
        assertRangeProblem(get(SUMMARY).param("from", TO.toString()).param("to", FROM.toString()),
            "getAnalyticsSummary.to", "must not be before from");
    }

    /** Checked after the defaults: a future from with no to is checked against today. */
    @Test
    void aFutureFromAlone_isAFieldErrorOnTo() throws Exception {
        LocalDate future = LocalDate.now(ZoneOffset.UTC).plusDays(2);
        assertRangeProblem(get(SUMMARY).param("from", future.toString()),
            "getAnalyticsSummary.to", "must not be before from");
    }

    @Test
    void aRangeOf366Days_isAccepted_and367IsAFieldErrorOnFrom() throws Exception {
        LocalDate to = LocalDate.of(2026, 3, 1);

        assertThat(summary(to.minusDays(365), to).days()).hasSize(366);
        assertRangeProblem(get(SUMMARY).param("from", to.minusDays(366).toString()).param("to", to.toString()),
            "getAnalyticsSummary.from", "must make a range of at most 366 days, both ends included");
        assertRangeProblem(get(SUMMARY).param("from", LocalDate.now(ZoneOffset.UTC).minusDays(400).toString()),
            "getAnalyticsSummary.from", "must make a range of at most 366 days, both ends included");
    }

    /**
     * The parser takes a nine-digit year of either sign, so these parse and are the controller's to
     * refuse. Unrefused they were a 500 from Postgres or from {@code LocalDate} arithmetic, or a
     * 200 for a range of nothing. The end is checked first, so {@code to} is the field whenever
     * both ends are out. A literal {@code +} is as MockMvc sends it; over HTTP it is %2B.
     */
    @Test
    void aFarFutureTo_isAFieldErrorOnTo() throws Exception {
        assertRangeProblem(get(SUMMARY).param("to", "+999999999-12-31"),
            "getAnalyticsSummary.to", DATE_OUT_OF_RANGE);
    }

    /** With no {@code from}, deriving its default from this {@code to} would itself have thrown. */
    @Test
    void aFarPastToAlone_isAFieldErrorOnTo() throws Exception {
        assertRangeProblem(get(SUMMARY).param("to", "-999999999-01-02"),
            "getAnalyticsSummary.to", DATE_OUT_OF_RANGE);
    }

    @Test
    void aFarPastRange_isAFieldErrorOnTo_sinceTheEndIsCheckedFirst() throws Exception {
        assertRangeProblem(
            get(SUMMARY).param("from", "-999999999-01-01").param("to", "-999999999-01-02"),
            "getAnalyticsSummary.to", DATE_OUT_OF_RANGE);
    }

    /** Before this check, only the 366-day limit stood between this and Postgres. */
    @Test
    void aFarPastFromWithAnOrdinaryTo_isAFieldErrorOnFrom() throws Exception {
        assertRangeProblem(
            get(SUMMARY).param("from", "-999999999-01-01").param("to", TO.toString()),
            "getAnalyticsSummary.from", DATE_OUT_OF_RANGE);
    }

    /** The default start is checked like a sent one: 29 days before 0001-01-10 is in year 0. */
    @Test
    void aDefaultFromBeforeYear1_isAFieldErrorOnFrom() throws Exception {
        assertRangeProblem(get(SUMMARY).param("to", "0001-01-10"),
            "getAnalyticsSummary.from", DATE_OUT_OF_RANGE);
    }

    /** The limits are inclusive, and Postgres and {@code plusDays} both cope with them. */
    @Test
    void theFirstAndLastSupportedDays_areAccepted() throws Exception {
        assertThat(summary(LocalDate.of(9999, 12, 1), LocalDate.of(9999, 12, 31)).days())
            .hasSize(31);
        assertThat(summary(LocalDate.of(1, 1, 1), LocalDate.of(1, 1, 2)).days()).hasSize(2);
    }

    /**
     * Not a field error: binding fails before the handler runs, and ResponseEntityExceptionHandler
     * answers with Spring's own body for a MethodArgumentTypeMismatchException. The contract says
     * only "a plain problem with no errors"; the whole body is pinned so a Spring upgrade that
     * changes it is noticed. Note the detail repeats the value sent, which is Spring's wording.
     */
    @Test
    void anUnparseableDate_isAPlain400_withNoErrors() throws Exception {
        Map<MockHttpServletRequestBuilder, String> cases = Map.of(
            get(SUMMARY).param("from", "yesterday"), "Failed to convert 'from' with value: 'yesterday'",
            get(SUMMARY).param("to", "2026-02-30"), "Failed to convert 'to' with value: '2026-02-30'",
            get(SUMMARY).param("from", "01/03/2026"), "Failed to convert 'from' with value: '01/03/2026'");
        for (Map.Entry<MockHttpServletRequestBuilder, String> unparseable : cases.entrySet()) {
            MockHttpServletResponse response = perform(unparseable.getKey());

            assertThat(response.getStatus()).isEqualTo(400);
            assertThat(response.getContentType()).isEqualTo("application/problem+json");
            assertThat(objectMapper.readValue(response.getContentAsString(), Map.class)).isEqualTo(Map.of(
                "title", "Bad Request",
                "status", 400,
                "detail", unparseable.getValue(),
                "instance", SUMMARY));
        }
    }

    /** Pins the constant the error keys are built from to the handler's real name. */
    @Test
    void theErrorKeyPrefixIsTheHandlersName() throws Exception {
        Method handler = AdminAnalyticsController.class.getMethod(
            AdminAnalyticsController.HANDLER_NAME, LocalDate.class, LocalDate.class);

        assertThat(handler.getName()).isEqualTo("getAnalyticsSummary");
    }

    // ---------------------------------------------------------------------------------------

    private AnalyticsSummary summary(LocalDate from, LocalDate to) throws Exception {
        return read(perform(get(SUMMARY).param("from", from.toString()).param("to", to.toString())));
    }

    private AnalyticsSummary read(MockHttpServletResponse response) throws Exception {
        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(200);
        return objectMapper.readValue(response.getContentAsString(), AnalyticsSummary.class);
    }

    private MockHttpServletResponse perform(MockHttpServletRequestBuilder request) throws Exception {
        return mockMvc.perform(request.header("Authorization", "Bearer " + adminToken)).andReturn().getResponse();
    }

    private void assertRangeProblem(MockHttpServletRequestBuilder request, String field, String message) throws Exception {
        MockHttpServletResponse response = perform(request);

        assertThat(response.getStatus()).isEqualTo(400);
        assertThat(response.getContentType()).isEqualTo("application/problem+json");
        assertThat(objectMapper.readValue(response.getContentAsString(), Map.class)).isEqualTo(Map.of(
            "title", "Validation Failed",
            "status", 400,
            "detail", "Request failed validation",
            "instance", SUMMARY,
            "errors", List.of(Map.of("field", field, "message", message))));
    }

    private void view(String hash, AnalyticsPage page, UUID projectId, LocalDate day) {
        assertThat(store.insertIfAbsent(AnalyticsEventType.PAGE_VIEW, page, projectId, null, hash, day)).isOne();
    }

    private void click(String hash, UUID projectId, String url, LocalDate day) {
        assertThat(store.insertIfAbsent(AnalyticsEventType.LINK_CLICK, AnalyticsPage.PROJECT, projectId, url, hash, day))
            .isOne();
    }

    private UUID saveProject(String title, boolean isPublished, List<Link> links) {
        Project project = new Project(title, title + " description");
        project.setPublished(isPublished);
        project.setLinks(links);
        return projectRepository.saveAndFlush(project).getId();
    }
}
