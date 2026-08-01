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
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.web.client.DefaultResponseErrorHandler;
import org.springframework.web.client.RestTemplate;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

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
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:17-alpine");

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
