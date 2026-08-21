package io.github.tarka1939.mysite.project;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.web.client.DefaultResponseErrorHandler;
import org.springframework.web.client.RestTemplate;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

import io.github.tarka1939.mysite.auth.AdminUser;
import io.github.tarka1939.mysite.auth.AdminUserRepository;
import io.github.tarka1939.mysite.auth.LoginResponse;

/**
 * The public/admin split, over real HTTP through the real filter chain.
 *
 * <p>Everything asserted here is a claim about who can see what, and those are the claims a
 * service-level test cannot make: {@code @PreAuthorize}, the {@code authorizeHttpRequests} rules
 * and the status code a rejection turns into all live in layers that only an actual request
 * passes through. What a delivery *writes* is tested below the HTTP layer instead, in
 * {@code GithubProjectSyncIntegrationTest} -- see its note on why.
 *
 * <p>Not {@code @Transactional}, and each test uses its own titles: requests run on the embedded
 * server's threads, so the rollback trick does not apply. Same shape as
 * {@code SecurityIntegrationTest}, including its plain non-throwing {@link RestTemplate}.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Testcontainers
@ActiveProfiles("test")
// One instance for the whole class, so that @BeforeAll can log in exactly once. That is not a
// tidiness choice: admin login is rate-limited per requester, every test here shares 127.0.0.1,
// and a login per test trips the limiter and fails the later tests with a 429 -- which it did,
// on the first run of this class. Reusing one token also matches how a browser session behaves.
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class ProjectPublicationVisibilityIntegrationTest {

    @Container
    @ServiceConnection
    static PostgreSQLContainer postgres = new PostgreSQLContainer("postgres:17-alpine");

    @LocalServerPort
    private int port;

    @Autowired
    private AdminUserRepository adminUserRepository;

    @Autowired
    private PasswordEncoder passwordEncoder;

    private final RestTemplate restTemplate = nonThrowingRestTemplate();

    private String token;

    @BeforeAll
    void logInOnce() {
        token = adminToken("visibility-admin");
    }

    /**
     * The decision this test exists to pin. A draft answers 404 publicly, exactly as an id that
     * names nothing does -- not 403.
     *
     * <p>403 is the more literal description of what happened and is the wrong answer: it
     * confirms that the id names a real project. Since Phase 7a, drafts are auto-created from
     * whatever repositories the owner pushes to, private ones included, so "this id is real but
     * not yours" is precisely the fact worth withholding. The 404 also makes the two cases
     * indistinguishable, which is the property that survives someone later guessing ids.
     */
    @Test
    void anUnpublishedProjectIs404Publicly_andReadableByTheAdmin() {
        String id = createProject(token, "Draft 404 case", false, null);

        ResponseEntity<String> publicRead =
            restTemplate.getForEntity(url("/api/v1/projects/" + id), String.class);
        assertThat(publicRead.getStatusCode())
            .as("a draft must be indistinguishable from a nonexistent project")
            .isEqualTo(HttpStatus.NOT_FOUND);

        ResponseEntity<String> nonexistent = restTemplate.getForEntity(
            url("/api/v1/projects/" + UUID.randomUUID()), String.class);
        assertThat(publicRead.getStatusCode()).isEqualTo(nonexistent.getStatusCode());

        ResponseEntity<Map> adminRead = restTemplate.exchange(
            url("/api/v1/admin/projects/" + id), HttpMethod.GET, authed(token), Map.class);
        assertThat(adminRead.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(adminRead.getBody().get("published")).isEqualTo(false);
    }

    @Test
    void thePublicListingExcludesDrafts_andTheAdminListingIncludesThem() {
        createProject(token, "Listing: published one", true, null);
        createProject(token, "Listing: draft one", false, null);

        List<Map<String, Object>> publicContent = content(restTemplate.getForEntity(
            url("/api/v1/projects?size=100"), Map.class));
        assertThat(titles(publicContent)).contains("Listing: published one");
        assertThat(titles(publicContent)).doesNotContain("Listing: draft one");
        assertThat(publicContent).allSatisfy(project ->
            assertThat(project.get("published")).isEqualTo(true));

        List<Map<String, Object>> adminContent = content(restTemplate.exchange(
            url("/api/v1/admin/projects?size=100"), HttpMethod.GET, authed(token), Map.class));
        assertThat(titles(adminContent))
            .contains("Listing: published one", "Listing: draft one");
    }

    /**
     * The admin read endpoints are denied twice over -- no {@code permitAll} matcher covers
     * {@code /api/v1/admin/**}, and the controller additionally requires the ADMIN role. Without
     * this the whole "separate path" design would be decoration.
     */
    @Test
    void theAdminReadEndpointsRejectAnUnauthenticatedRequest() {
        assertThat(restTemplate.getForEntity(url("/api/v1/admin/projects"), String.class)
            .getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThat(restTemplate.getForEntity(
            url("/api/v1/admin/projects/" + UUID.randomUUID()), String.class)
            .getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    /**
     * The other route to a blank site, and the reason {@code published} is "omitted means
     * unchanged" rather than a plain full replacement: a client written before Phase 7a sends no
     * {@code published} at all, and if that silence read as false, editing a live project would
     * take it off the site.
     */
    @Test
    void aPutThatSaysNothingAboutPublication_leavesALiveProjectLive() {
        String id = createProject(token, "Stays live", true, null);

        ResponseEntity<Map> updated = restTemplate.exchange(
            url("/api/v1/projects/" + id), HttpMethod.PUT,
            new HttpEntity<>(Map.of(
                "title", "Stays live, edited",
                "description", "Edited by a client that has never heard of published",
                "tags", List.of()), authHeaders(token)),
            Map.class);

        assertThat(updated.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(updated.getBody().get("published")).isEqualTo(true);
        assertThat(restTemplate.getForEntity(url("/api/v1/projects/" + id), String.class)
            .getStatusCode()).isEqualTo(HttpStatus.OK);
    }

    /** ...and un-publishing still works, when it is asked for explicitly. */
    @Test
    void aPutThatSaysPublishedFalse_takesTheProjectOffTheSite() {
        String id = createProject(token, "Goes dark", true, null);

        restTemplate.exchange(url("/api/v1/projects/" + id), HttpMethod.PUT,
            new HttpEntity<>(Map.of(
                "title", "Goes dark",
                "description", "Explicitly un-published",
                "tags", List.of(),
                "published", false), authHeaders(token)),
            Map.class);

        assertThat(restTemplate.getForEntity(url("/api/v1/projects/" + id), String.class)
            .getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
    }

    /**
     * GET /tags populates the public "filter by tag" control, so a tag reachable only through a
     * draft would be a filter value that returns an empty list -- the same defect as the
     * E2E-scaffolding tag that reached the public filter in Phase 6, by a new route.
     */
    @Test
    void aTagReachableOnlyThroughADraftIsNotOfferedPublicly() {
        createProject(token, "Tagged draft", false, "unreleased-experiment");

        ResponseEntity<List> tags = restTemplate.getForEntity(url("/api/v1/tags"), List.class);

        assertThat(tags.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(tags.getBody().stream()
            .map(tag -> ((Map<?, ?>) tag).get("name"))
            .toList())
            .doesNotContain("unreleased-experiment");
    }

    /**
     * Two projects cannot claim one repository, or a delivery would have no single project to
     * match. 409 rather than a 500 from the unique index.
     */
    @Test
    void claimingARepositoryAnotherProjectAlreadyTracks_is409() {
        createProject(token, "First claimant", true, null, "tarka1939/Conflict");

        ResponseEntity<String> second = restTemplate.postForEntity(
            url("/api/v1/projects"),
            new HttpEntity<>(Map.of(
                "title", "Second claimant",
                "description", "Wants the same repository",
                "tags", List.of(),
                "repoFullName", "TARKA1939/conflict"), authHeaders(token)),
            String.class);

        assertThat(second.getStatusCode())
            .as("case-insensitively the same repository, so still a conflict")
            .isEqualTo(HttpStatus.CONFLICT);
    }

    /** A repoFullName that is not owner/name could never match a delivery, so it is a 400. */
    @Test
    void aRepoFullNameThatIsNotOwnerSlashName_is400() {

        ResponseEntity<String> response = restTemplate.postForEntity(
            url("/api/v1/projects"),
            new HttpEntity<>(Map.of(
                "title", "Bad repo name",
                "description", "Not a GitHub full name",
                "tags", List.of(),
                "repoFullName", "just-a-name"), authHeaders(token)),
            String.class);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
    }

    // -------------------------------------------------------------------------------------
    // Helpers.
    // -------------------------------------------------------------------------------------

    private String createProject(String token, String title, boolean published, String tag) {
        return createProject(token, title, published, tag, null);
    }

    private String createProject(
        String token, String title, boolean published, String tag, String repoFullName
    ) {
        Map<String, Object> body = new java.util.HashMap<>(Map.of(
            "title", title,
            "description", "Created by " + getClass().getSimpleName(),
            "tags", tag == null ? List.of() : List.of(tag),
            "published", published));
        if (repoFullName != null) {
            body.put("repoFullName", repoFullName);
        }

        ResponseEntity<Map> created = restTemplate.postForEntity(
            url("/api/v1/projects"), new HttpEntity<>(body, authHeaders(token)), Map.class);
        assertThat(created.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        return (String) created.getBody().get("id");
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> content(ResponseEntity<Map> page) {
        assertThat(page.getStatusCode()).isEqualTo(HttpStatus.OK);
        return (List<Map<String, Object>>) page.getBody().get("content");
    }

    private static List<Object> titles(List<Map<String, Object>> content) {
        return content.stream().map(project -> project.get("title")).toList();
    }

    private String adminToken(String username) {
        seedAdmin(username, username + "@example.invalid", "s3cure-p@ssword!");

        ResponseEntity<LoginResponse> login = restTemplate.postForEntity(
            url("/api/v1/auth/login"),
            Map.of("username", username, "password", "s3cure-p@ssword!"),
            LoginResponse.class);
        assertThat(login.getStatusCode()).isEqualTo(HttpStatus.OK);
        return login.getBody().token();
    }

    private void seedAdmin(String username, String email, String rawPassword) {
        try {
            // Same reflection as SecurityIntegrationTest: AdminUser's constructor is protected
            // and this test is outside its package.
            var constructor = AdminUser.class.getDeclaredConstructor();
            constructor.setAccessible(true);
            AdminUser adminUser = constructor.newInstance();
            var usernameField = AdminUser.class.getDeclaredField("username");
            usernameField.setAccessible(true);
            usernameField.set(adminUser, username);
            var emailField = AdminUser.class.getDeclaredField("email");
            emailField.setAccessible(true);
            emailField.set(adminUser, email);
            adminUser.setPasswordHash(passwordEncoder.encode(rawPassword));
            adminUserRepository.saveAndFlush(adminUser);
        } catch (ReflectiveOperationException e) {
            throw new RuntimeException(e);
        }
    }

    private static HttpHeaders authHeaders(String token) {
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(token);
        return headers;
    }

    private static HttpEntity<Void> authed(String token) {
        return new HttpEntity<>(authHeaders(token));
    }

    private String url(String path) {
        return "http://localhost:" + port + path;
    }

    private static RestTemplate nonThrowingRestTemplate() {
        RestTemplate template = new RestTemplate(new SimpleClientHttpRequestFactory());
        template.setErrorHandler(new DefaultResponseErrorHandler() {
            @Override
            public boolean hasError(org.springframework.http.client.ClientHttpResponse response) {
                return false;
            }
        });
        return template;
    }
}
