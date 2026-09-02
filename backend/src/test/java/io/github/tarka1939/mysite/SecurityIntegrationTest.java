package io.github.tarka1939.mysite;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.client.JdkClientHttpRequestFactory;
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
 * The one test in this Phase that goes through the real HTTP + Spring Security filter chain
 * (RANDOM_PORT, real requests) rather than calling services directly -- @PreAuthorize
 * annotations and the SecurityFilterChain's authorizeHttpRequests rules are only meaningfully
 * verified by an actual request passing through them.
 *
 * <p>Uses a plain {@link RestTemplate} rather than Boot's {@code TestRestTemplate} --
 * unlike Boot 3, {@code TestRestTemplate} isn't resolvable from spring-boot-starter-test's
 * declared dependencies in this Boot 4.1.0 setup (a further instance of the test-artifact
 * fragmentation AGENT_LOG.md already documents for @DataJpaTest). A custom error handler that
 * never throws on 4xx/5xx reproduces the one behavior actually needed from it.
 *
 * <p>Not @Transactional: requests run on the embedded server's own thread/connection, not the
 * test method's, so the usual transactional-rollback trick doesn't apply here -- each test
 * uses unique data instead.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Testcontainers
@ActiveProfiles("test")
class SecurityIntegrationTest {

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

    /**
     * A second client for the CORS tests, on the JDK HTTP client rather than
     * {@link SimpleClientHttpRequestFactory}'s {@code HttpURLConnection}. Not a style preference:
     * {@code HttpURLConnection} silently drops {@code Origin} and
     * {@code Access-Control-Request-Method}, both of which are on its restricted-header list, so a
     * CORS test written on it would send no preflight at all and would then pass or fail for
     * reasons that have nothing to do with the configuration under test.
     */
    private final RestTemplate corsRestTemplate = nonThrowingCorsRestTemplate();

    private static RestTemplate nonThrowingCorsRestTemplate() {
        RestTemplate template = new RestTemplate(new JdkClientHttpRequestFactory());
        template.setErrorHandler(new DefaultResponseErrorHandler() {
            @Override
            public boolean hasError(org.springframework.http.client.ClientHttpResponse response) {
                return false;
            }
        });
        return template;
    }

    private String url(String path) {
        return "http://localhost:" + port + path;
    }

    @Test
    void publicEndpointsAreAccessibleWithoutAToken() {
        assertThat(restTemplate.getForEntity(url("/api/v1/projects"), String.class).getStatusCode())
            .isEqualTo(HttpStatus.OK);
        assertThat(restTemplate.getForEntity(url("/api/v1/tags"), String.class).getStatusCode())
            .isEqualTo(HttpStatus.OK);

        Map<String, String> contactBody = Map.of(
            "name", "Anonymous", "email", "anon@example.com", "message", "Hi from a public request");
        assertThat(restTemplate.postForEntity(url("/api/v1/contact"), contactBody, String.class).getStatusCode())
            .isEqualTo(HttpStatus.CREATED);
    }

    @Test
    void writeEndpointsRejectRequestsWithoutAToken() {
        Map<String, Object> projectBody = Map.of(
            "title", "Should be rejected", "description", "No token attached", "tags", java.util.List.of());

        assertThat(restTemplate.postForEntity(url("/api/v1/projects"), projectBody, String.class).getStatusCode())
            .isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThat(restTemplate.exchange(url("/api/v1/projects/" + java.util.UUID.randomUUID()),
            HttpMethod.PUT, new HttpEntity<>(projectBody), String.class).getStatusCode())
            .isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThat(restTemplate.exchange(url("/api/v1/projects/" + java.util.UUID.randomUUID()),
            HttpMethod.DELETE, HttpEntity.EMPTY, String.class).getStatusCode())
            .isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThat(restTemplate.getForEntity(url("/api/v1/contact-messages"), String.class).getStatusCode())
            .isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    @Test
    void loginWithWrongPasswordReturns401() {
        seedAdmin("wrong-pw-admin", "wrong-pw-admin@example.com", "the-real-password");

        ResponseEntity<String> response = restTemplate.postForEntity(
            url("/api/v1/auth/login"), Map.of("username", "wrong-pw-admin", "password", "not-the-real-password"), String.class);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    @Test
    void adminCanLoginAndPerformFullWriteLifecycleWithTheIssuedToken() {
        seedAdmin("full-flow-admin", "full-flow-admin@example.com", "s3cure-p@ssword!");

        ResponseEntity<LoginResponse> loginResponse = restTemplate.postForEntity(
            url("/api/v1/auth/login"),
            Map.of("username", "full-flow-admin", "password", "s3cure-p@ssword!"),
            LoginResponse.class);
        assertThat(loginResponse.getStatusCode()).isEqualTo(HttpStatus.OK);
        String token = loginResponse.getBody().token();
        assertThat(token).isNotBlank();

        HttpHeaders authHeaders = new HttpHeaders();
        authHeaders.setBearerAuth(token);

        Map<String, Object> createBody = Map.of(
            "title", "Full lifecycle project", "description", "Created via the real HTTP filter chain",
            "tags", java.util.List.of("integration"));
        ResponseEntity<Map> created = restTemplate.postForEntity(
            url("/api/v1/projects"), new HttpEntity<>(createBody, authHeaders), Map.class);
        assertThat(created.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        String projectId = (String) created.getBody().get("id");

        Map<String, Object> updateBody = Map.of(
            "title", "Updated title", "description", "Updated via PUT", "tags", java.util.List.of("integration"));
        ResponseEntity<Map> updated = restTemplate.exchange(
            url("/api/v1/projects/" + projectId), HttpMethod.PUT, new HttpEntity<>(updateBody, authHeaders), Map.class);
        assertThat(updated.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(updated.getBody().get("title")).isEqualTo("Updated title");

        ResponseEntity<Void> deleted = restTemplate.exchange(
            url("/api/v1/projects/" + projectId), HttpMethod.DELETE, new HttpEntity<>(authHeaders), Void.class);
        assertThat(deleted.getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);

        ResponseEntity<String> getAfterDelete = restTemplate.getForEntity(url("/api/v1/projects/" + projectId), String.class);
        assertThat(getAfterDelete.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
    }

    /**
     * The deployed Netlify origin, asserted as a literal on purpose. The test profile inherits
     * {@code app.cors.allowed-origins} from the base {@code application.yml} rather than
     * overriding it, so a typo in the value that production will actually use fails here rather
     * than at the browser, where a wrong origin and no CORS config at all look identical.
     */
    private static final String ALLOWED_ORIGIN = "https://krzysztof-tarka.netlify.app";

    @Test
    void preflightFromTheAllowedOriginIsApproved() {
        HttpHeaders preflight = new HttpHeaders();
        preflight.setOrigin(ALLOWED_ORIGIN);
        preflight.setAccessControlRequestMethod(HttpMethod.GET);

        ResponseEntity<String> response = corsRestTemplate.exchange(
            url("/api/v1/projects"), HttpMethod.OPTIONS, new HttpEntity<>(preflight), String.class);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(response.getHeaders().getAccessControlAllowOrigin()).isEqualTo(ALLOWED_ORIGIN);
        assertThat(response.getHeaders().getAccessControlAllowMethods())
            .contains(HttpMethod.GET, HttpMethod.POST, HttpMethod.PUT, HttpMethod.DELETE);
        // Access-Control-Allow-Headers is deliberately not asserted here: Spring only writes it in
        // reply to an Access-Control-Request-Headers, which this preflight does not send. The next
        // test is the one that sends it.
    }

    @Test
    void preflightCarryingAuthorizationOnAWriteIsApproved() {
        HttpHeaders preflight = new HttpHeaders();
        preflight.setOrigin(ALLOWED_ORIGIN);
        preflight.setAccessControlRequestMethod(HttpMethod.POST);
        preflight.setAccessControlRequestHeaders(java.util.List.of("authorization", "content-type"));

        ResponseEntity<String> response = corsRestTemplate.exchange(
            url("/api/v1/projects"), HttpMethod.OPTIONS, new HttpEntity<>(preflight), String.class);

        // A preflight carries no credentials, so this also pins the ordering that makes it work:
        // CORS is handled inside the security filter chain, before authorization would answer an
        // unauthenticated OPTIONS on a protected path with a 401.
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(response.getHeaders().getAccessControlAllowOrigin()).isEqualTo(ALLOWED_ORIGIN);
        // The admin JWT rides in Authorization, so a preflight that did not permit it would leave
        // every write from the deployed SPA failing while public reads kept working.
        assertThat(response.getHeaders().getAccessControlAllowHeaders())
            .map(header -> header.toLowerCase(java.util.Locale.ROOT))
            .contains("authorization", "content-type");
    }

    @Test
    void preflightFromAnUnlistedOriginIsRefused() {
        HttpHeaders preflight = new HttpHeaders();
        preflight.setOrigin("https://not-my-site.example.com");
        preflight.setAccessControlRequestMethod(HttpMethod.GET);

        ResponseEntity<String> response = corsRestTemplate.exchange(
            url("/api/v1/projects"), HttpMethod.OPTIONS, new HttpEntity<>(preflight), String.class);

        assertThat(response.getHeaders().getAccessControlAllowOrigin())
            .as("no Access-Control-Allow-Origin means the browser refuses to hand the response to the page")
            .isNull();
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
    }

    @Test
    void preflightFromANetlifyDeployPreviewIsRefused() {
        // Deploy previews are deliberately not allowlisted, and this is the test that says so.
        // Admitting them needs a wildcard pattern such as https://*--<site>.netlify.app, which
        // would also admit a preview built from a fork's pull request -- arbitrary third-party
        // JavaScript on an origin this API answers.
        HttpHeaders preflight = new HttpHeaders();
        preflight.setOrigin("https://deploy-preview-42--krzysztof-tarka.netlify.app");
        preflight.setAccessControlRequestMethod(HttpMethod.GET);

        ResponseEntity<String> response = corsRestTemplate.exchange(
            url("/api/v1/projects"), HttpMethod.OPTIONS, new HttpEntity<>(preflight), String.class);

        assertThat(response.getHeaders().getAccessControlAllowOrigin()).isNull();
    }

    @Test
    void actualRequestFromTheAllowedOriginCarriesTheAllowOriginHeader() {
        // The preflight is not the whole contract: the browser also checks the real response.
        HttpHeaders headers = new HttpHeaders();
        headers.setOrigin(ALLOWED_ORIGIN);

        ResponseEntity<String> response = corsRestTemplate.exchange(
            url("/api/v1/projects"), HttpMethod.GET, new HttpEntity<>(headers), String.class);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(response.getHeaders().getAccessControlAllowOrigin()).isEqualTo(ALLOWED_ORIGIN);
        // allowCredentials stays false: the SPA sends an explicit Authorization header, which is
        // not a CORS credential. If cookies are ever added this flips, and a wildcard origin
        // becomes impossible at the same moment.
        assertThat(response.getHeaders().getAccessControlAllowCredentials()).isFalse();
    }

    private void seedAdmin(String username, String email, String rawPassword) {
        try {
            // AdminUser's constructor is protected and this test lives outside its package
            // (io.github.tarka1939.mysite, not .auth) -- reflection (with setAccessible) is
            // needed for construction here too, not just for the fields.
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
}
