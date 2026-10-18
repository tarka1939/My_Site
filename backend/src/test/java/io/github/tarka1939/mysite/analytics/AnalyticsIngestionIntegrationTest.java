package io.github.tarka1939.mysite.analytics;

import static io.github.tarka1939.mysite.analytics.AnalyticsTestSupport.BROWSER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

import io.github.tarka1939.mysite.TestPostgres;
import io.github.tarka1939.mysite.auth.AdminUserRepository;
import io.github.tarka1939.mysite.project.Link;
import io.github.tarka1939.mysite.project.Project;
import io.github.tarka1939.mysite.project.ProjectRepository;

import tools.jackson.databind.ObjectMapper;

/**
 * The two event endpoints (#58) against real Postgres, through the whole filter chain.
 *
 * <p>MockMvc rather than a real port, because the tests need to choose the requester's address:
 * every test takes a fresh TEST-NET-3 address, so the shared rate limiter's buckets and the dedup
 * index never carry one test's visitor into the next, and the table is emptied before each.
 *
 * <p>A stored hash is checked against {@link DailyVisitorHasher} itself, asked for the same
 * address afterwards. A run that crosses UTC midnight between the request and that question
 * would fail, which is the hasher working rather than a fault.
 */
@SpringBootTest(properties = {
    "app.analytics.enabled=true",
    // So the log check below sees everything this application could write at its most verbose.
    "logging.level.io.github.tarka1939.mysite=DEBUG"})
@AutoConfigureMockMvc
@Testcontainers
@ActiveProfiles("test")
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@ExtendWith(OutputCaptureExtension.class)
class AnalyticsIngestionIntegrationTest {

    private static final String PAGE_VIEWS = "/api/v1/analytics/page-views";
    private static final String LINK_CLICKS = "/api/v1/analytics/link-clicks";
    private static final String GITHUB = "https://github.com/tarka1939/Equalizer";
    private static final String DEMO = "https://example.com/eq";
    private static final String DRAFT_LINK = "https://example.com/draft";
    private static final String OTHER_LINK = "https://example.com/other";

    /** TEST-NET-3, from .10 up; the trusted proxy block (198.51.100.0/24) is never handed out. */
    private static final AtomicInteger NEXT_ADDRESS = new AtomicInteger(10);

    @Container
    @ServiceConnection
    static PostgreSQLContainer postgres = TestPostgres.container();

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private JdbcClient jdbc;

    @Autowired
    private DailyVisitorHasher hasher;

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

    private UUID published;
    private UUID draft;
    private UUID other;
    private String adminToken;

    @BeforeAll
    void seed() throws Exception {
        published = saveProject("Equalizer", true, List.of(new Link("GitHub", GITHUB), new Link("Demo", DEMO)));
        draft = saveProject("Draft", false, List.of(new Link("Repo", DRAFT_LINK)));
        other = saveProject("Other", true, List.of(new Link("Site", OTHER_LINK)));

        AnalyticsTestSupport.seedAdmin(adminUserRepository, passwordEncoder, "analytics-ingest-admin");
        MockHttpServletResponse login = mockMvc.perform(post("/api/v1/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content(AnalyticsTestSupport.loginJson("analytics-ingest-admin"))
                .with(from(nextAddress())))
            .andExpect(status().isOk())
            .andReturn().getResponse();
        adminToken = (String) objectMapper.readValue(login.getContentAsString(), Map.class).get("token");
    }

    @BeforeEach
    void emptyTheTable() {
        jdbc.sql("DELETE FROM analytics_event").update();
    }

    // ---------------------------------------------------------------------------------------
    // Counted.
    // ---------------------------------------------------------------------------------------

    @Test
    void aValidAboutView_isExactlyOneRow_withExactlyTheRightColumns() throws Exception {
        String address = nextAddress();

        send(pageView(address, "{\"page\":\"about\"}"));

        assertThat(rows()).containsExactly(new Row("page_view", "about", null, null, hashOf(address), today()));
    }

    @Test
    void aValidProjectView_storesThePublishedProject() throws Exception {
        String address = nextAddress();

        send(pageView(address, "{\"page\":\"project\",\"projectId\":\"" + published + "\"}"));

        assertThat(rows()).containsExactly(new Row("page_view", "project", published, null, hashOf(address), today()));
    }

    @Test
    void aValidLinkClick_storesTheLinkOnTheProjectsPage() throws Exception {
        String address = nextAddress();

        send(linkClick(address, published, DEMO));

        assertThat(rows()).containsExactly(new Row("link_click", "project", published, DEMO, hashOf(address), today()));
    }

    @Test
    void everyPageOnTheList_isCounted() throws Exception {
        String address = nextAddress();
        for (String page : List.of("about", "projects", "contact", "privacy")) {
            send(pageView(address, "{\"page\":\"" + page + "\"}"));
        }

        assertThat(rows()).extracting(Row::page).containsExactlyInAnyOrder("about", "projects", "contact", "privacy");
    }

    /** Only {@code 1} opts out; {@code 0} is a visitor saying they do not mind. */
    @Test
    void dntZeroAndSecGpcZero_areCounted() throws Exception {
        String address = nextAddress();

        send(pageView(address, "{\"page\":\"about\"}").header("DNT", "0").header("Sec-GPC", "0"));

        assertThat(rows()).hasSize(1);
    }

    /** The visitor is whoever ClientIpResolver says, so a proxied request is its client, not the proxy. */
    @Test
    void throughTheTrustedProxy_theVisitorIsTheForwardedClient() throws Exception {
        String client = nextAddress();

        send(pageView("198.51.100.5", "{\"page\":\"about\"}").header("CF-Connecting-IP", client));

        assertThat(rows()).extracting(Row::visitorHash).containsExactly(hashOf(client));
    }

    @Test
    void aForwardedHeaderFromAnUntrustedPeer_isIgnored() throws Exception {
        String peer = nextAddress();
        String claimed = nextAddress();

        send(pageView(peer, "{\"page\":\"about\"}").header("CF-Connecting-IP", claimed));

        assertThat(rows()).extracting(Row::visitorHash).containsExactly(hashOf(peer));
    }

    // ---------------------------------------------------------------------------------------
    // At most one row per visitor, page, project, link and day.
    // ---------------------------------------------------------------------------------------

    /** The case NULLS NOT DISTINCT exists for: both rows have a null project_id and link_url. */
    @Test
    void twoAboutViewsByOneVisitor_areOneRow() throws Exception {
        String address = nextAddress();

        send(pageView(address, "{\"page\":\"about\"}"));
        send(pageView(address, "{\"page\":\"about\"}"));

        assertThat(rows()).hasSize(1);
    }

    @Test
    void oneVisitorsDistinctEvents_areDistinctRows_andRepeatsAreNot() throws Exception {
        String address = nextAddress();

        send(pageView(address, "{\"page\":\"project\",\"projectId\":\"" + published + "\"}"));
        send(pageView(address, "{\"page\":\"project\",\"projectId\":\"" + published + "\"}"));
        send(pageView(address, "{\"page\":\"project\",\"projectId\":\"" + other + "\"}"));
        send(linkClick(address, published, GITHUB));
        send(linkClick(address, published, GITHUB));
        send(linkClick(address, published, DEMO));

        assertThat(rows()).hasSize(4);
    }

    @Test
    void theSamePageByTwoVisitors_isTwoRows() throws Exception {
        send(pageView(nextAddress(), "{\"page\":\"about\"}"));
        send(pageView(nextAddress(), "{\"page\":\"about\"}"));

        assertThat(rows()).hasSize(2);
    }

    /**
     * The dedup decided by the database, not by a pre-check: every thread is released into the
     * insert at once, and the index lets exactly one of them write.
     */
    @Test
    void concurrentIdenticalInserts_areOneRow() throws Exception {
        int threads = 16;
        String hash = hashOf(nextAddress());
        LocalDate day = today();
        CyclicBarrier start = new CyclicBarrier(threads);
        ExecutorService pool = Executors.newFixedThreadPool(threads);
        try {
            List<Future<Integer>> inserted = new ArrayList<>();
            for (int i = 0; i < threads; i++) {
                inserted.add(pool.submit(() -> {
                    start.await(10, TimeUnit.SECONDS);
                    return store.insertIfAbsent(AnalyticsEventType.PAGE_VIEW, AnalyticsPage.ABOUT, null, null, hash, day);
                }));
            }
            int total = 0;
            for (Future<Integer> result : inserted) {
                total += result.get(30, TimeUnit.SECONDS);
            }
            assertThat(total).as("exactly one insert reported a row").isEqualTo(1);
        } finally {
            pool.shutdownNow();
        }
        assertThat(rows()).hasSize(1);
    }

    @Test
    void theSamePageByTheSameVisitorOnTwoDays_isTwoRows() {
        String hash = hashOf(nextAddress());

        store.insertIfAbsent(AnalyticsEventType.PAGE_VIEW, AnalyticsPage.ABOUT, null, null, hash, LocalDate.of(2026, 10, 17));
        store.insertIfAbsent(AnalyticsEventType.PAGE_VIEW, AnalyticsPage.ABOUT, null, null, hash, LocalDate.of(2026, 10, 18));

        assertThat(rows()).extracting(Row::occurredOn)
            .containsExactlyInAnyOrder(LocalDate.of(2026, 10, 17), LocalDate.of(2026, 10, 18));
    }

    @Test
    void theDedupIndexIsUniqueAndNullsNotDistinct() {
        String definition = jdbc.sql("SELECT indexdef FROM pg_indexes WHERE indexname = 'ux_analytics_event_dedup'")
            .query(String.class).single();

        assertThat(definition)
            .startsWith("CREATE UNIQUE INDEX")
            .contains("(occurred_on, visitor_hash, event_type, page, project_id, link_url)")
            .contains("NULLS NOT DISTINCT");
    }

    // ---------------------------------------------------------------------------------------
    // Dropped, with the same 204.
    // ---------------------------------------------------------------------------------------

    @Test
    void doNotTrack_isDropped() throws Exception {
        assertDropped(pageView(nextAddress(), "{\"page\":\"about\"}").header("DNT", "1"));
    }

    @Test
    void globalPrivacyControl_isDropped() throws Exception {
        assertDropped(pageView(nextAddress(), "{\"page\":\"about\"}").header("Sec-GPC", "1"));
    }

    @Test
    void theAdminsOwnVisits_areDropped() throws Exception {
        assertDropped(pageView(nextAddress(), "{\"page\":\"about\"}").header("Authorization", "Bearer " + adminToken));
        assertDropped(linkClick(nextAddress(), published, DEMO).header("Authorization", "Bearer " + adminToken));
    }

    @Test
    void aMissingUserAgent_isDropped() throws Exception {
        assertDropped(post(PAGE_VIEWS)
            .contentType(MediaType.APPLICATION_JSON)
            .content("{\"page\":\"about\"}")
            .with(from(nextAddress())));
    }

    @ParameterizedTest
    @ValueSource(strings = {
        " ",
        "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/131.0.0.0 Safari/537.36",
        "Mozilla/5.0 (compatible; Baiduspider/2.0; +http://www.baidu.com/search/spider.html)",
    })
    void aBlankOrAutomatedUserAgent_isDropped(String userAgent) throws Exception {
        assertDropped(post(PAGE_VIEWS)
            .contentType(MediaType.APPLICATION_JSON)
            .content("{\"page\":\"about\"}")
            .header("User-Agent", userAgent)
            .with(from(nextAddress())));
    }

    @Test
    void aViewOfAProjectThatDoesNotExist_isDropped() throws Exception {
        assertDropped(pageView(nextAddress(), "{\"page\":\"project\",\"projectId\":\"" + UUID.randomUUID() + "\"}"));
    }

    @Test
    void aViewOfADraft_isDropped() throws Exception {
        assertDropped(pageView(nextAddress(), "{\"page\":\"project\",\"projectId\":\"" + draft + "\"}"));
    }

    @Test
    void aClickOnAProjectThatDoesNotExist_isDropped() throws Exception {
        assertDropped(linkClick(nextAddress(), UUID.randomUUID(), DEMO));
    }

    @Test
    void aClickOnADraftsOwnLink_isDropped() throws Exception {
        assertDropped(linkClick(nextAddress(), draft, DRAFT_LINK));
    }

    /** Exactly one of the project's current link URLs, or nothing: no normalising of any kind. */
    @ParameterizedTest
    @ValueSource(strings = {
        "https://example.com/eq/",
        "https://github.com/tarka1939/equalizer",
        "http://example.com/eq",
        " https://example.com/eq",
        "Demo",
        OTHER_LINK,
        " ",
    })
    void aClickOnAUrlThatIsNotExactlyOneOfThatProjectsLinks_isDropped(String url) throws Exception {
        assertDropped(linkClick(nextAddress(), published, url));
    }

    // ---------------------------------------------------------------------------------------
    // Security.
    // ---------------------------------------------------------------------------------------

    /** A token is checked whenever one is sent, so a bad one is a 401, not an anonymous event. */
    @Test
    void anInvalidBearerToken_is401_andNothingIsStored() throws Exception {
        mockMvc.perform(pageView(nextAddress(), "{\"page\":\"about\"}").header("Authorization", "Bearer not-a-jwt"))
            .andExpect(status().isUnauthorized());

        assertThat(rows()).isEmpty();
    }

    /** The permit is POST only. */
    @Test
    void aGetOnAnEventPath_isNotPublic() throws Exception {
        mockMvc.perform(get(PAGE_VIEWS).header("User-Agent", BROWSER).with(from(nextAddress())))
            .andExpect(status().isUnauthorized());
        mockMvc.perform(get(LINK_CLICKS).header("User-Agent", BROWSER).with(from(nextAddress())))
            .andExpect(status().isUnauthorized());
    }

    // ---------------------------------------------------------------------------------------
    // Validation: 400, the whole body, and nothing stored.
    // ---------------------------------------------------------------------------------------

    @Test
    void aPageOffTheList_isAFieldErrorOnPage() throws Exception {
        assertValidationProblem(pageView(nextAddress(), "{\"page\":\"admin\"}"), PAGE_VIEWS,
            Map.of("page", "must be one of about, projects, project, contact, privacy"));
    }

    @Test
    void aMissingPage_isAFieldErrorOnPage() throws Exception {
        assertValidationProblem(pageView(nextAddress(), "{}"), PAGE_VIEWS, Map.of("page", "must not be null"));
    }

    @Test
    void aProjectPageWithNoProject_isAFieldErrorOnProjectId() throws Exception {
        assertValidationProblem(pageView(nextAddress(), "{\"page\":\"project\"}"), PAGE_VIEWS,
            Map.of("projectId", "is required when page is project"));
    }

    @Test
    void anotherPageWithAProject_isAFieldErrorOnProjectId() throws Exception {
        assertValidationProblem(pageView(nextAddress(), "{\"page\":\"about\",\"projectId\":\"" + published + "\"}"),
            PAGE_VIEWS, Map.of("projectId", "must not be set unless page is project"));
    }

    @Test
    void aLinkClickWithNeitherField_isAFieldErrorOnEach() throws Exception {
        assertValidationProblem(linkClickJson(nextAddress(), "{}"), LINK_CLICKS,
            Map.of("projectId", "must not be null", "url", "must not be null"));
    }

    @Test
    void aLinkClickUrlOutsideTheContractsLengths_isAFieldErrorOnUrl() throws Exception {
        assertValidationProblem(linkClick(nextAddress(), published, ""), LINK_CLICKS,
            Map.of("url", "size must be between 1 and 500"));
        assertValidationProblem(linkClick(nextAddress(), published, "https://example.com/" + "a".repeat(481)), LINK_CLICKS,
            Map.of("url", "size must be between 1 and 500"));
    }

    @Test
    void aLinkClickUrlOfExactly500Characters_isWellFormed() throws Exception {
        assertDropped(linkClick(nextAddress(), published, "https://example.com/" + "a".repeat(480)));
    }

    /** Not a field error: the body never became a request to validate. */
    @Test
    void malformedJsonOrAMalformedUuid_isAPlain400_withNoErrors() throws Exception {
        for (MockHttpServletRequestBuilder request : List.of(
            pageView(nextAddress(), "{\"page\":"),
            pageView(nextAddress(), "{\"page\":\"project\",\"projectId\":\"not-a-uuid\"}"))) {
            MockHttpServletResponse response = mockMvc.perform(request).andReturn().getResponse();

            assertThat(response.getStatus()).isEqualTo(400);
            Map<String, Object> body = objectMapper.readValue(response.getContentAsString(), Map.class);
            assertThat(body).doesNotContainKey("errors");
            assertThat(body.get("status")).isEqualTo(400);
        }
        assertThat(rows()).isEmpty();
    }

    // ---------------------------------------------------------------------------------------
    // The rate limit.
    // ---------------------------------------------------------------------------------------

    @Test
    void theEventPastTheLimit_is429() throws Exception {
        String address = nextAddress();
        for (int i = 0; i < AnalyticsService.MAX_EVENTS_PER_WINDOW; i++) {
            send(pageView(address, "{\"page\":\"about\"}"));
        }

        MockHttpServletResponse refused = mockMvc.perform(linkClick(address, published, DEMO)).andReturn().getResponse();

        assertThat(refused.getStatus()).isEqualTo(429);
        Map<?, ?> body = objectMapper.readValue(refused.getContentAsString(), Map.class);
        assertThat(body.get("title")).isEqualTo("Too Many Requests");
        assertThat(body.get("detail")).isEqualTo("Too many analytics events");
        assertThat(rows()).as("the click past the limit was not stored").hasSize(1);
    }

    /** Header drops never reach the limiter: there is no hash yet to key it on. */
    @Test
    void headerDrops_doNotCountAgainstTheLimit() throws Exception {
        String address = nextAddress();
        for (int i = 0; i <= AnalyticsService.MAX_EVENTS_PER_WINDOW; i++) {
            send(pageView(address, "{\"page\":\"about\"}").header("DNT", "1"));
        }

        send(pageView(address, "{\"page\":\"about\"}"));

        assertThat(rows()).hasSize(1);
    }

    /** Drops on what the event names do count, so the 429 says nothing about which ids exist. */
    @Test
    void projectDrops_countAgainstTheLimit() throws Exception {
        String address = nextAddress();
        for (int i = 0; i < AnalyticsService.MAX_EVENTS_PER_WINDOW; i++) {
            send(pageView(address, "{\"page\":\"project\",\"projectId\":\"" + UUID.randomUUID() + "\"}"));
        }

        mockMvc.perform(pageView(address, "{\"page\":\"about\"}")).andExpect(status().isTooManyRequests());

        assertThat(rows()).isEmpty();
    }

    // ---------------------------------------------------------------------------------------
    // Nothing reaches a log.
    // ---------------------------------------------------------------------------------------

    /**
     * A violated CHECK means a bug here rather than a bad request, and Postgres words one with the
     * failing row in full. The exception that leaves the store carries neither that row nor the
     * hash in it, and no cause that could.
     */
    @Test
    void aConstraintViolation_leavesTheStoreWithoutTheRowOrTheHash() {
        String hash = hashOf(nextAddress());

        assertThatThrownBy(() -> store.insertIfAbsent(
                AnalyticsEventType.PAGE_VIEW, AnalyticsPage.ABOUT, UUID.randomUUID(), null, hash, today()))
            .isInstanceOf(IllegalStateException.class)
            .hasNoCause()
            .hasMessageContaining("event_type=page_view")
            .hasMessageNotContaining(hash);
        // ck_analytics_event_visitor_hash: an address where the hash belongs is refused.
        String address = nextAddress();
        assertThatThrownBy(() -> store.insertIfAbsent(
                AnalyticsEventType.PAGE_VIEW, AnalyticsPage.ABOUT, null, null, address, today()))
            .isInstanceOf(IllegalStateException.class)
            .hasNoCause()
            .hasMessageNotContaining(address);
        assertThat(rows()).isEmpty();
    }

    @Test
    void neitherTheAddressNorTheHashIsLogged_atDebug(CapturedOutput output) throws Exception {
        String address = nextAddress();
        send(pageView(address, "{\"page\":\"about\"}"));
        send(linkClick(address, published, DEMO));
        String hash = hashOf(address);

        assertThat(rows()).hasSize(2);
        assertThat(output.getAll()).doesNotContain(hash).doesNotContain(address);
    }

    // ---------------------------------------------------------------------------------------

    private record Row(String eventType, String page, UUID projectId, String linkUrl, String visitorHash,
                       LocalDate occurredOn) {
    }

    private List<Row> rows() {
        return jdbc.sql("SELECT event_type, page, project_id, link_url, visitor_hash, occurred_on FROM analytics_event")
            .query((rs, rowNum) -> new Row(
                rs.getString("event_type"),
                rs.getString("page"),
                rs.getObject("project_id", UUID.class),
                rs.getString("link_url"),
                rs.getString("visitor_hash"),
                rs.getObject("occurred_on", LocalDate.class)))
            .list();
    }

    private String hashOf(String address) {
        return hasher.identify(address).orElseThrow().visitorHash();
    }

    private LocalDate today() {
        return hasher.identify("192.0.2.1").orElseThrow().day();
    }

    private static String nextAddress() {
        int next = NEXT_ADDRESS.getAndIncrement();
        if (next > 254) {
            throw new IllegalStateException("out of TEST-NET-3 addresses");
        }
        return "203.0.113." + next;
    }

    private static RequestPostProcessor from(String address) {
        return request -> {
            request.setRemoteAddr(address);
            return request;
        };
    }

    private static MockHttpServletRequestBuilder pageView(String address, String json) {
        return post(PAGE_VIEWS)
            .contentType(MediaType.APPLICATION_JSON)
            .content(json)
            .header("User-Agent", BROWSER)
            .with(from(address));
    }

    private static MockHttpServletRequestBuilder linkClickJson(String address, String json) {
        return post(LINK_CLICKS)
            .contentType(MediaType.APPLICATION_JSON)
            .content(json)
            .header("User-Agent", BROWSER)
            .with(from(address));
    }

    private MockHttpServletRequestBuilder linkClick(String address, UUID projectId, String url) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("projectId", projectId.toString());
        body.put("url", url);
        return linkClickJson(address, objectMapper.writeValueAsString(body));
    }

    /** 204 with an empty body, which is every well-formed event's answer. */
    private void send(MockHttpServletRequestBuilder request) throws Exception {
        MockHttpServletResponse response = mockMvc.perform(request).andReturn().getResponse();
        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(204);
        assertThat(response.getContentAsString()).isEmpty();
    }

    private void assertDropped(MockHttpServletRequestBuilder request) throws Exception {
        send(request);
        assertThat(rows()).as("a dropped event stores nothing").isEmpty();
    }

    private void assertValidationProblem(MockHttpServletRequestBuilder request, String path,
                                         Map<String, String> fieldErrors) throws Exception {
        MockHttpServletResponse response = mockMvc.perform(request).andReturn().getResponse();

        assertThat(response.getStatus()).isEqualTo(400);
        assertThat(response.getContentType()).isEqualTo("application/problem+json");
        Map<String, Object> body = objectMapper.readValue(response.getContentAsString(), Map.class);
        @SuppressWarnings("unchecked")
        List<Map<String, String>> errors = (List<Map<String, String>>) body.remove("errors");
        // Every key, so a new one appearing fails too. No "type": Spring leaves out the default
        // about:blank, as docs/openapi.yaml's ProblemDetail allows.
        assertThat(body).isEqualTo(Map.of(
            "title", "Validation Failed",
            "status", 400,
            "detail", "Request failed validation",
            "instance", path));
        assertThat(errors).containsExactlyInAnyOrderElementsOf(fieldErrors.entrySet().stream()
            .map(error -> Map.of("field", error.getKey(), "message", error.getValue()))
            .toList());
        assertThat(rows()).isEmpty();
    }

    private UUID saveProject(String title, boolean isPublished, List<Link> links) {
        Project project = new Project(title, title + " description");
        project.setPublished(isPublished);
        project.setLinks(links);
        return projectRepository.saveAndFlush(project).getId();
    }
}
