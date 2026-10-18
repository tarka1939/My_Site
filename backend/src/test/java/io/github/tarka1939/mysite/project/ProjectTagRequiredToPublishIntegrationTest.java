package io.github.tarka1939.mysite.project;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

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
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.web.client.DefaultResponseErrorHandler;
import org.springframework.web.client.RestTemplate;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

import io.github.tarka1939.mysite.TestPostgres;
import io.github.tarka1939.mysite.auth.AdminUser;
import io.github.tarka1939.mysite.auth.AdminUserRepository;
import io.github.tarka1939.mysite.auth.LoginResponse;

/**
 * #148 over real HTTP: a published project needs at least one tag, and a draft may have none.
 *
 * <p>Through the real service, not a mocked one, because the rule lives there -- the PUT case
 * turns on the stored {@code published} value, which only a real project row has -- and through
 * the real {@code GlobalExceptionHandler}, because the response body is the contract the admin
 * form reads. The 400 is asserted field by field: a bare status would also be satisfied by any
 * other validation failure on the same body.
 *
 * <p>Same shape as {@link ProjectPublicationVisibilityIntegrationTest}: not
 * {@code @Transactional}, each test using its own titles, and one login for the class because
 * admin login is rate-limited per requester.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Testcontainers
@ActiveProfiles("test")
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class ProjectTagRequiredToPublishIntegrationTest {

    /** The admin form shows the same words, so the exact text is asserted, not a constant. */
    private static final String TAG_REQUIRED = "At least one tag is required to publish";

    @Container
    @ServiceConnection
    static PostgreSQLContainer postgres = TestPostgres.container();

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
        token = adminToken("tag-rule-admin");
    }

    // -------------------------------------------------------------------------------------
    // Rejected: every write that would leave a published project with no tags.
    // -------------------------------------------------------------------------------------

    @Test
    void aPostThatPublishesWithNoTags_is400WithAFieldErrorOnTags() {
        ResponseEntity<Map> response = post(body("Explicitly published, untagged", List.of(), true));

        assertIsTheTagRequiredValidationError(response);
        assertThat(adminTitles()).doesNotContain("Explicitly published, untagged");
    }

    /** Omitted means published on create, so this is held to the rule as an explicit true is. */
    @Test
    void aPostThatOmitsPublishedWithNoTags_is400WithAFieldErrorOnTags() {
        ResponseEntity<Map> response = post(body("Implicitly published, untagged", List.of(), null));

        assertIsTheTagRequiredValidationError(response);
        assertThat(adminTitles()).doesNotContain("Implicitly published, untagged");
    }

    @Test
    void aPutThatPublishesADraftWithNoTags_is400_andTheDraftStaysADraft() {
        String id = create(body("Draft, untagged", List.of(), false));

        ResponseEntity<Map> response = put(id, body("Draft, untagged, published", List.of(), true));

        assertIsTheTagRequiredValidationError(response);
        Map<String, Object> stored = adminRead(id);
        assertThat(stored.get("published")).isEqualTo(false);
        assertThat(stored.get("title")).isEqualTo("Draft, untagged");
    }

    /**
     * The case only the stored value decides. The same body against a draft is allowed (see
     * below); against a live project, "leave published as it is" leaves it live, untagged.
     */
    @Test
    void aPutThatOmitsPublishedWithNoTags_onALiveProject_is400_andChangesNothing() {
        String id = create(body("Live and tagged", List.of("kept"), true));

        ResponseEntity<Map> response = put(id, body("Live, tags cleared", List.of(), null));

        assertIsTheTagRequiredValidationError(response);
        Map<String, Object> stored = adminRead(id);
        assertThat(stored.get("published")).isEqualTo(true);
        assertThat(stored.get("title")).isEqualTo("Live and tagged");
        assertThat(tagNames(stored)).containsExactly("kept");
    }

    // -------------------------------------------------------------------------------------
    // Allowed.
    // -------------------------------------------------------------------------------------

    /** What a webhook-created draft needs: to be saved as it is, before it has any tags. */
    @Test
    void aDraftCanBeCreatedAndSavedWithNoTags() {
        String id = create(body("Untagged draft", List.of(), false));

        ResponseEntity<Map> saved = put(id, body("Untagged draft, edited", List.of(), null));

        assertThat(saved.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(saved.getBody().get("published")).isEqualTo(false);
        assertThat(tagNames(saved.getBody())).isEmpty();
    }

    @Test
    void unpublishingAndClearingTheTagsInOnePut_isAllowed() {
        String id = create(body("Live, about to go dark", List.of("going"), true));

        ResponseEntity<Map> saved = put(id, body("Dark and untagged", List.of(), false));

        assertThat(saved.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(saved.getBody().get("published")).isEqualTo(false);
        assertThat(tagNames(saved.getBody())).isEmpty();
    }

    @Test
    void publishingADraftWithATag_isAllowed() {
        String id = create(body("Draft about to go live", List.of(), false));

        ResponseEntity<Map> saved = put(id, body("Draft about to go live", List.of("live-now"), true));

        assertThat(saved.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(saved.getBody().get("published")).isEqualTo(true);
        assertThat(tagNames(saved.getBody())).containsExactly("live-now");
    }

    // -------------------------------------------------------------------------------------
    // Helpers.
    // -------------------------------------------------------------------------------------

    /**
     * The whole body, not only the status: the same ValidationProblemDetail a Bean Validation
     * failure produces, with exactly one error, on {@code tags}, in the words the form shows.
     */
    @SuppressWarnings("unchecked")
    private static void assertIsTheTagRequiredValidationError(ResponseEntity<Map> response) {
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(response.getHeaders().getContentType())
            .matches(type -> type.isCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON));

        Map<String, Object> problem = response.getBody();
        assertThat(problem.get("status")).isEqualTo(400);
        assertThat(problem.get("title")).isEqualTo("Validation Failed");
        assertThat(problem.get("detail")).isEqualTo("Request failed validation");

        List<Map<String, Object>> errors = (List<Map<String, Object>>) problem.get("errors");
        assertThat(errors).hasSize(1);
        assertThat(errors.get(0).get("field")).isEqualTo("tags");
        assertThat(errors.get(0).get("message")).isEqualTo(TAG_REQUIRED);
    }

    private static Map<String, Object> body(String title, List<String> tags, Boolean published) {
        Map<String, Object> body = new HashMap<>(Map.of(
            "title", title,
            "description", "Written by ProjectTagRequiredToPublishIntegrationTest",
            "tags", tags));
        if (published != null) {
            body.put("published", published);
        }
        return body;
    }

    private ResponseEntity<Map> post(Map<String, Object> body) {
        return restTemplate.postForEntity(
            url("/api/v1/projects"), new HttpEntity<>(body, authHeaders(token)), Map.class);
    }

    private ResponseEntity<Map> put(String id, Map<String, Object> body) {
        return restTemplate.exchange(url("/api/v1/projects/" + id), HttpMethod.PUT,
            new HttpEntity<>(body, authHeaders(token)), Map.class);
    }

    private String create(Map<String, Object> body) {
        ResponseEntity<Map> created = post(body);
        assertThat(created.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        return (String) created.getBody().get("id");
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> adminRead(String id) {
        ResponseEntity<Map> read = restTemplate.exchange(url("/api/v1/admin/projects/" + id),
            HttpMethod.GET, new HttpEntity<>(authHeaders(token)), Map.class);
        assertThat(read.getStatusCode()).isEqualTo(HttpStatus.OK);
        return read.getBody();
    }

    @SuppressWarnings("unchecked")
    private List<Object> adminTitles() {
        ResponseEntity<Map> page = restTemplate.exchange(url("/api/v1/admin/projects?size=100"),
            HttpMethod.GET, new HttpEntity<>(authHeaders(token)), Map.class);
        assertThat(page.getStatusCode()).isEqualTo(HttpStatus.OK);
        return ((List<Map<String, Object>>) page.getBody().get("content")).stream()
            .map(project -> project.get("title"))
            .toList();
    }

    @SuppressWarnings("unchecked")
    private static List<Object> tagNames(Map<String, Object> project) {
        return ((List<Map<String, Object>>) project.get("tags")).stream()
            .map(tag -> tag.get("name"))
            .toList();
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
