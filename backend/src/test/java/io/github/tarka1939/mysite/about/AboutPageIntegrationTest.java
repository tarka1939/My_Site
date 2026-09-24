package io.github.tarka1939.mysite.about;

import static org.assertj.core.api.Assertions.assertThat;

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
 * The About page over HTTP against real Postgres (#213). Real Postgres rather than a mocked
 * repository because the migration is part of the change: the claim "the row always exists" is a
 * claim about {@code V8__about_page.sql} having run, and only a database that ran it can test it.
 *
 * <p>The resource is a singleton, so tests share it and cannot use "their own" row the way the
 * project tests use their own titles. Each test therefore leaves the body in a state no other test
 * depends on, and none asserts on the body it did not itself write.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Testcontainers
@ActiveProfiles("test")
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class AboutPageIntegrationTest {

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
        token = adminToken("about-admin");
    }

    @Test
    void thePageExistsBeforeAnyoneHasWrittenIt() {
        // The migration's guarantee, and the reason the SPA needs no "not created yet" branch.
        ResponseEntity<Map> response = restTemplate.getForEntity(url("/api/v1/about"), Map.class);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(response.getBody()).containsKey("body");
        assertThat(response.getBody().get("updatedAt"))
            .as("set by the migration, so never null even before the first write")
            .isNotNull();
    }

    @Test
    void anAdminCanReplaceTheBody_andTheNextPublicReadReturnsIt() {
        String markdown = "## Hello\n\nI build **DSP** things.";

        ResponseEntity<Map> write = restTemplate.exchange(
            url("/api/v1/about"), HttpMethod.PUT, authed(token, Map.of("body", markdown)), Map.class);
        assertThat(write.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(write.getBody().get("body")).isEqualTo(markdown);

        ResponseEntity<Map> read = restTemplate.getForEntity(url("/api/v1/about"), Map.class);
        assertThat(read.getBody().get("body"))
            .as("stored and returned verbatim -- the API never renders Markdown")
            .isEqualTo(markdown);
    }

    @Test
    void anEmptyBodyIsAValidWrite_notAValidationError() {
        // How the admin clears the page. @NotNull rather than @NotBlank on the request is what
        // this pins; a @NotBlank would make the page impossible to empty once written.
        ResponseEntity<Map> write = restTemplate.exchange(
            url("/api/v1/about"), HttpMethod.PUT, authed(token, Map.of("body", "")), Map.class);

        assertThat(write.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(write.getBody().get("body")).isEqualTo("");
    }

    @Test
    void savingTheSameBodyAgainDoesNotBumpUpdatedAt() {
        // "When the body was last replaced" is the contract's wording, and this is what makes it
        // true: Hibernate skips the UPDATE when dirty-checking finds nothing, so @UpdateTimestamp
        // never runs. Asserted rather than trusted, because it is a Hibernate behaviour a version
        // bump could change, and the entity comment would then be quietly wrong.
        String body = "Unchanged between two saves.";
        ResponseEntity<Map> first = restTemplate.exchange(
            url("/api/v1/about"), HttpMethod.PUT, authed(token, Map.of("body", body)), Map.class);
        ResponseEntity<Map> second = restTemplate.exchange(
            url("/api/v1/about"), HttpMethod.PUT, authed(token, Map.of("body", body)), Map.class);

        assertThat(second.getBody().get("updatedAt")).isEqualTo(first.getBody().get("updatedAt"));

        ResponseEntity<Map> changed = restTemplate.exchange(
            url("/api/v1/about"), HttpMethod.PUT, authed(token, Map.of("body", body + " Edited.")), Map.class);
        assertThat(changed.getBody().get("updatedAt"))
            .as("a different body is a replacement and must bump it")
            .isNotEqualTo(first.getBody().get("updatedAt"));
    }

    @Test
    void aBodyExactlyAtTheContractLimitIsAccepted() {
        // The boundary itself, so the 20001 -> 400 case below cannot pass by the limit being
        // off by one in the strict direction.
        String atLimit = "y".repeat(20000);

        ResponseEntity<Map> write = restTemplate.exchange(
            url("/api/v1/about"), HttpMethod.PUT, authed(token, Map.of("body", atLimit)), Map.class);

        assertThat(write.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(((String) write.getBody().get("body")).length()).isEqualTo(20000);
    }

    @Test
    void aBodyOverTheContractLimitIs400() {
        String tooLong = "x".repeat(20001);

        ResponseEntity<String> write = restTemplate.exchange(
            url("/api/v1/about"), HttpMethod.PUT, authed(token, Map.of("body", tooLong)), String.class);

        assertThat(write.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
    }

    @Test
    void aMissingBodyIs400() {
        ResponseEntity<String> write = restTemplate.exchange(
            url("/api/v1/about"), HttpMethod.PUT, authed(token, Map.of()), String.class);

        assertThat(write.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
    }

    @Test
    void anonymousWritesAreRejected() {
        // Also pinned in SecurityIntegrationTest alongside every other protected route; repeated
        // here so this class reads as the complete behaviour of the resource.
        ResponseEntity<String> write = restTemplate.exchange(
            url("/api/v1/about"), HttpMethod.PUT, new HttpEntity<>(Map.of("body", "nope")), String.class);

        assertThat(write.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
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
            // Same reflection as the other integration tests: the AdminUser constructor is
            // protected and this test is outside its package.
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

    private static <T> HttpEntity<T> authed(String token, T body) {
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(token);
        return new HttpEntity<>(body, headers);
    }
}
