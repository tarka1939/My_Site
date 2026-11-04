package io.github.tarka1939.mysite.analytics;

import static io.github.tarka1939.mysite.analytics.AnalyticsTestSupport.BROWSER;
import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;

import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.ApplicationContext;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.client.ClientHttpResponse;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.web.client.DefaultResponseErrorHandler;
import org.springframework.web.client.RestTemplate;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

import io.github.tarka1939.mysite.TestPostgres;
import io.github.tarka1939.mysite.auth.AdminUserRepository;
import io.github.tarka1939.mysite.auth.LoginResponse;

/**
 * The flag in its off position, through real HTTP, in a context of its own. No property is set
 * here: application-test.yml pins the flag off, and the base application.yml defaults it off, so
 * this is also the test that the shipped defaults produce an application with no analytics.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Testcontainers
@ActiveProfiles("test")
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class AnalyticsDisabledIntegrationTest {

    @Container
    @ServiceConnection
    static PostgreSQLContainer postgres = TestPostgres.container();

    @LocalServerPort
    private int port;

    @Autowired
    private ApplicationContext applicationContext;

    @Autowired
    private JdbcClient jdbc;

    @Autowired
    private AdminUserRepository adminUserRepository;

    @Autowired
    private PasswordEncoder passwordEncoder;

    private final RestTemplate restTemplate = nonThrowingRestTemplate();

    private String adminToken;

    @BeforeAll
    void logIn() {
        AnalyticsTestSupport.seedAdmin(adminUserRepository, passwordEncoder, "analytics-off-admin");
        ResponseEntity<LoginResponse> login = restTemplate.postForEntity(url("/api/v1/auth/login"),
            Map.of("username", "analytics-off-admin", "password", AnalyticsTestSupport.ADMIN_PASSWORD),
            LoginResponse.class);
        assertThat(login.getStatusCode()).isEqualTo(HttpStatus.OK);
        adminToken = login.getBody().token();
    }

    /**
     * Well-formed events, from an ordinary browser, get 404. Not 401: that would mean the filter
     * chain refused them, and the permit in SecurityConfig would be untested.
     */
    @Test
    void bothEventEndpoints_are404() {
        ResponseEntity<String> view = restTemplate.postForEntity(url("/api/v1/analytics/page-views"),
            new HttpEntity<>("{\"page\":\"about\"}", browserHeaders()), String.class);
        ResponseEntity<String> click = restTemplate.postForEntity(url("/api/v1/analytics/link-clicks"),
            new HttpEntity<>("{\"projectId\":\"00000000-0000-0000-0000-000000000001\",\"url\":\"https://example.com\"}",
                browserHeaders()), String.class);

        assertThat(view.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(click.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(view.getHeaders().getContentType()).hasToString("application/problem+json");
    }

    @Test
    void theSummary_is404ForTheAdmin() {
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(adminToken);

        ResponseEntity<String> summary = restTemplate.exchange(
            url("/api/v1/admin/analytics"), HttpMethod.GET, new HttpEntity<>(headers), String.class);

        assertThat(summary.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
    }

    /**
     * Without a token the summary is a 401, not the contract's 404: the filter chain refuses an
     * anonymous request to /api/v1/admin/** before dispatch can find that nothing serves it. Kept
     * that way on purpose; making it a 404 would mean a flag-dependent rule in SecurityConfig.
     */
    @Test
    void theSummary_withNoToken_is401_beforeAnythingCouldSay404() {
        ResponseEntity<String> summary = restTemplate.getForEntity(url("/api/v1/admin/analytics"), String.class);

        assertThat(summary.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    @Test
    void noAnalyticsBeanExists_andTheTableIsThereAndEmpty() {
        assertThat(applicationContext.getBeanNamesForType(DailyVisitorHasher.class)).isEmpty();
        assertThat(applicationContext.getBeanNamesForType(AnalyticsService.class)).isEmpty();
        assertThat(applicationContext.getBeanNamesForType(AnalyticsEventStore.class)).isEmpty();
        assertThat(applicationContext.getBeanNamesForType(AnalyticsSummaryService.class)).isEmpty();
        assertThat(applicationContext.getBeanNamesForType(AnalyticsController.class)).isEmpty();
        assertThat(applicationContext.getBeanNamesForType(AdminAnalyticsController.class)).isEmpty();

        assertThat(jdbc.sql("SELECT count(*) FROM analytics_event").query(Long.class).single()).isZero();
    }

    private static HttpHeaders browserHeaders() {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.set(HttpHeaders.USER_AGENT, BROWSER);
        return headers;
    }

    private String url(String path) {
        return "http://localhost:" + port + path;
    }

    private static RestTemplate nonThrowingRestTemplate() {
        RestTemplate template = new RestTemplate(new SimpleClientHttpRequestFactory());
        template.setErrorHandler(new DefaultResponseErrorHandler() {
            @Override
            public boolean hasError(ClientHttpResponse response) {
                return false;
            }
        });
        return template;
    }
}
