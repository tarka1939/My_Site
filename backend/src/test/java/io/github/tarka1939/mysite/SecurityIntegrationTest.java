package io.github.tarka1939.mysite;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
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
@ExtendWith(OutputCaptureExtension.class)
class SecurityIntegrationTest {

    @Container
    @ServiceConnection
    static PostgreSQLContainer postgres = TestPostgres.container();

    @LocalServerPort
    private int port;

    @Autowired
    private AdminUserRepository adminUserRepository;

    @Autowired
    private PasswordEncoder passwordEncoder;

    @Autowired
    private io.micrometer.core.instrument.MeterRegistry meterRegistry;

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
        // The one public surface #213 added. Listed here so the permitAll line it needed in
        // SecurityConfig is pinned by the same test that pins every other one.
        assertThat(restTemplate.getForEntity(url("/api/v1/about"), String.class).getStatusCode())
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
        // And the write half of #213 -- protected by anyRequest().authenticated() with no change to
        // SecurityConfig, which is exactly the property worth a test: fail closed by default.
        assertThat(restTemplate.exchange(url("/api/v1/about"),
            HttpMethod.PUT, new HttpEntity<>(Map.of("body", "no token")), String.class).getStatusCode())
            .isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThat(restTemplate.exchange(url("/api/v1/projects/" + java.util.UUID.randomUUID()),
            HttpMethod.DELETE, HttpEntity.EMPTY, String.class).getStatusCode())
            .isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThat(restTemplate.getForEntity(url("/api/v1/contact-messages"), String.class).getStatusCode())
            .isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    /**
     * #255. A missing or refused bearer token gets a 401 with no body: Spring Security's entry
     * point writes the status and an RFC 6750 {@code WWW-Authenticate} challenge, and nothing else.
     * docs/openapi.yaml says so, and this is what keeps it true. A token is checked wherever it is
     * sent, so a bad one is refused on a public read as well.
     *
     * <p>GETs only: this client has been seen to return no body for a POST's 401 even when one was
     * sent, so a POST case here would pass either way.
     */
    @Test
    void aMissingOrRefusedTokenGetsAChallengeAndNoBody() {
        HttpHeaders badToken = new HttpHeaders();
        badToken.setBearerAuth("x.y.z");

        ResponseEntity<String> missing = restTemplate.getForEntity(url("/api/v1/contact-messages"), String.class);
        ResponseEntity<String> refused = restTemplate.exchange(
            url("/api/v1/projects"), HttpMethod.GET, new HttpEntity<>(badToken), String.class);

        for (ResponseEntity<String> response : java.util.List.of(missing, refused)) {
            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
            assertThat(response.getBody()).isNull();
            assertThat(response.getHeaders().getContentType()).isNull();
            // Not "Bearer " with a space: before Spring Security 7 the missing-token challenge
            // was a bare "Bearer", and it would be again if resource_metadata were ever dropped.
            assertThat(response.getHeaders().getFirst(HttpHeaders.WWW_AUTHENTICATE)).matches("Bearer( .*)?");
        }
        assertThat(missing.getHeaders().getFirst(HttpHeaders.WWW_AUTHENTICATE)).doesNotContain("error=");
        assertThat(refused.getHeaders().getFirst(HttpHeaders.WWW_AUTHENTICATE)).contains("error=\"invalid_token\"");
    }

    /**
     * #122. Checked on a refusal as well as a success: the 401 is written by the resource
     * server's entry point rather than a controller, so this shows the headers are not confined to
     * controller responses. A request the firewall rejects outright is covered by the next test.
     * Two kinds of answer still go without them: an error rendered on the container's error
     * dispatch, and a 400 Tomcat writes itself, before Spring sees the request at all -- an
     * encoded slash or NUL in the path ({@code %2f}, {@code %00}) gets Tomcat's own HTML page.
     */
    @Test
    void apiResponsesCarryTheSecurityHeaders() {
        ResponseEntity<String> ok = restTemplate.getForEntity(url("/api/v1/projects"), String.class);
        ResponseEntity<String> refused = restTemplate.exchange(url("/api/v1/projects"),
            HttpMethod.POST, new HttpEntity<>(Map.of()), String.class);

        assertThat(ok.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
        for (ResponseEntity<String> response : java.util.List.of(ok, refused)) {
            HttpHeaders headers = response.getHeaders();
            assertThat(headers.getFirst("Content-Security-Policy"))
                .isEqualTo("default-src 'none'; frame-ancestors 'none'");
            assertThat(headers.getFirst("Referrer-Policy")).isEqualTo("no-referrer");
            // Spring Security's defaults, asserted so that configuring headers() never
            // silently replaces them.
            assertThat(headers.getFirst("X-Frame-Options")).isEqualTo("DENY");
            assertThat(headers.getFirst("X-Content-Type-Options")).isEqualTo("nosniff");
            // Plain HTTP, with app.tls-terminated-upstream off as in dev: no HSTS (#260).
            // UpstreamTlsIntegrationTest boots with the production setting and gets it.
            assertThat(headers.getFirst("Strict-Transport-Security")).isNull();
        }
    }

    /**
     * #256. Spring Security 7 publishes this whether or not anything asks for it, and answers it
     * before the rules in SecurityConfig, so it is public. Pinned so that a change to what it
     * claims, or to whether it answers at all, fails here rather than surfacing in production.
     */
    @Test
    void theResourceMetadataSpringPublishesClaimsNothingFalse() {
        ResponseEntity<Map<String, Object>> response = restTemplate.exchange(
            url("/.well-known/oauth-protected-resource"), HttpMethod.GET, HttpEntity.EMPTY,
            new org.springframework.core.ParameterizedTypeReference<Map<String, Object>>() {});

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(response.getBody()).containsOnlyKeys(
            "resource", "bearer_methods_supported", "tls_client_certificate_bound_access_tokens");
        // HS256 JWTs, bound to no client certificate. Spring's default says they are.
        assertThat(response.getBody()).containsEntry("tls_client_certificate_bound_access_tokens", false);
        // The default BearerTokenResolver reads the Authorization header and nothing else.
        assertThat(response.getBody()).containsEntry("bearer_methods_supported", java.util.List.of("header"));
        // Plain HTTP here; UpstreamTlsIntegrationTest has the production scheme.
        assertThat(response.getBody()).containsEntry("resource", "http://localhost:" + port);
    }

    /**
     * #243. The firewall refuses these before the filter chain runs, so neither its header
     * writers nor its rules see them; production answered with a bare 401. Compared against every
     * header an ordinary response carries rather than against a list here, so a header added to
     * SecurityConfig later is checked without anyone remembering to. A handler that wrote a copied
     * list of headers instead of running the chain's own writers passes only while the copy is
     * complete, and fails as soon as the two drift: a header added to SecurityConfig, say.
     */
    @Test
    void firewallRejectedRequestsGetA400WithTheSameSecurityHeaders() {
        HttpHeaders ordinary = restTemplate.getForEntity(url("/api/v1/projects"), String.class).getHeaders();
        // One rule stands for all of them: the handler does not look at why. Not "//", which the
        // client collapses to "/" before sending; curl showed the firewall refuses that one too.
        ResponseEntity<String> rejected = restTemplate.getForEntity(url("/api/v1/projects;x"), String.class);

        assertThat(rejected.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(rejected.getHeaders().getContentType()).hasToString("application/problem+json;charset=UTF-8");
        // Exactly the fixed body: the firewall's message can quote a header's value, a bearer
        // token included, and must never be reflected back.
        assertThat(rejected.getBody()).isEqualTo(SecurityHeadersRequestRejectedHandler.BODY);
        // The 401 production sent came from the error dispatch's entry point.
        assertThat(rejected.getHeaders().containsHeader(HttpHeaders.WWW_AUTHENTICATE)).isFalse();

        // Everything else the 200 carries is a security header. These differ per response, or come
        // from a filter a rejected request never reaches (Vary is CorsFilter's).
        java.util.Set<String> perResponse = new java.util.TreeSet<>(String.CASE_INSENSITIVE_ORDER);
        perResponse.addAll(java.util.List.of(HttpHeaders.CONTENT_TYPE, HttpHeaders.CONTENT_LENGTH,
            HttpHeaders.TRANSFER_ENCODING, HttpHeaders.DATE, "Keep-Alive", HttpHeaders.CONNECTION, HttpHeaders.VARY));
        java.util.List<String> security = ordinary.headerNames().stream()
            .filter(name -> !perResponse.contains(name)).toList();
        // Guards the comparison: a 200 that had lost its headers would otherwise compare nothing.
        for (String name : java.util.List.of("Content-Security-Policy", "Referrer-Policy",
                "X-Frame-Options", "X-Content-Type-Options", "Cache-Control")) {
            assertThat(ordinary.get(name)).as(name).isNotEmpty();
        }
        for (String name : security) {
            assertThat(rejected.getHeaders().get(name)).as(name).isEqualTo(ordinary.get(name));
        }
    }

    /**
     * Supplying our own RequestRejectedHandler drops the marker Spring composes in when it is given
     * none, so SecurityConfig composes it back. Without it the request metrics record a rejection
     * as {@code exception=none}, the same as a 400 a controller chose to send.
     */
    @Test
    void firewallRejectionsAreStillMarkedInTheRequestMetrics() {
        restTemplate.getForEntity(url("/api/v1/projects;x"), String.class);

        // The server stops the observation as the exchange completes, which can be after the
        // client already has the response.
        org.awaitility.Awaitility.await().atMost(java.time.Duration.ofSeconds(5)).untilAsserted(() ->
            assertThat(meterRegistry.find("http.server.requests")
                .tag("exception", "RequestRejectedException").timer()).isNotNull());
    }

    /**
     * #252. A header value is checked only when something reads it, so a bad one the firewall
     * first sees inside Spring MVC is thrown there -- here by the body converter reading
     * {@code Content-Type} on a public endpoint -- and the catch-all answered 500, with an ERROR
     * stack trace quoting the value. {@code 0x85} is obs-text to Tomcat, which lets it through,
     * and a C1 control to the firewall, which refuses it.
     *
     * <p>A raw socket rather than either client: both validate header values before sending, so
     * neither can put this byte on the wire.
     */
    @Test
    void aHeaderTheFirewallRefusesInsideSpringMvcGetsA400NotA500(CapturedOutput output) throws Exception {
        String body = "{\"username\":\"nobody\",\"password\":\"x\"}";
        java.io.ByteArrayOutputStream request = new java.io.ByteArrayOutputStream();
        request.writeBytes(("POST /api/v1/auth/login HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n"
            + "Content-Length: " + body.length() + "\r\nContent-Type: application/json")
            .getBytes(java.nio.charset.StandardCharsets.ISO_8859_1));
        request.write(0x85);
        request.writeBytes(("\r\n\r\n" + body).getBytes(java.nio.charset.StandardCharsets.ISO_8859_1));

        String response;
        try (java.net.Socket socket = new java.net.Socket("localhost", port)) {
            socket.setSoTimeout(10_000);
            socket.getOutputStream().write(request.toByteArray());
            response = new String(socket.getInputStream().readAllBytes(), java.nio.charset.StandardCharsets.ISO_8859_1);
        }
        String head = response.substring(0, response.indexOf("\r\n\r\n")).toLowerCase(java.util.Locale.ROOT);

        assertThat(response).startsWith("HTTP/1.1 400 ");
        assertThat(head).contains("content-type: application/problem+json");
        // Rendered inside the chain, so it carries the headers every other answer does.
        assertThat(head).contains("content-security-policy: default-src 'none'; frame-ancestors 'none'");
        // The same fixed detail the firewall's own handler sends; nothing of the value comes back.
        assertThat(response).contains("\"detail\":\"The request was rejected.\"");
        assertThat(response.substring(response.indexOf("\r\n\r\n"))).doesNotContain("application/json");
        // A client error, so no ERROR line and no stack trace for a caller to produce at will.
        assertThat(output.getAll()).doesNotContain("Unhandled exception");
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
