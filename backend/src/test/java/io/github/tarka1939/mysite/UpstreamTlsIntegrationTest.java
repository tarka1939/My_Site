package io.github.tarka1939.mysite;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.test.context.ActiveProfiles;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

/**
 * #260, with the setting production uses: {@code app.tls-terminated-upstream=true}.
 * {@link SecurityIntegrationTest} runs with it off and checks the opposite.
 *
 * <p>Requests go over a raw socket so that each one carries the {@code Host} header the
 * production proxy sends, a bare name with no port. That is the case where the port Tomcat
 * reports has to come from the scheme, and an HTTP client would always add one.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = "app.tls-terminated-upstream=true")
@Testcontainers
@ActiveProfiles("test")
class UpstreamTlsIntegrationTest {

    @Container
    @ServiceConnection
    static PostgreSQLContainer postgres = TestPostgres.container();

    /** RFC 2606's reserved name, standing in for the production host. */
    private static final String HOST = "api.example";

    @LocalServerPort
    private int port;

    private String get(String path) throws IOException {
        String request = "GET " + path + " HTTP/1.1\r\nHost: " + HOST + "\r\nConnection: close\r\n\r\n";
        try (Socket socket = new Socket("localhost", port)) {
            socket.setSoTimeout(10_000);
            socket.getOutputStream().write(request.getBytes(StandardCharsets.ISO_8859_1));
            return new String(socket.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
        }
    }

    private static String head(String response) {
        return response.substring(0, response.indexOf("\r\n\r\n")).toLowerCase(Locale.ROOT);
    }

    @Test
    void responsesCarryHsts() throws IOException {
        String response = get("/api/v1/tags");

        assertThat(response).startsWith("HTTP/1.1 200 ");
        // Spring Security's default value, written once the request reports itself secure.
        assertThat(head(response)).contains("strict-transport-security: max-age=31536000 ; includesubdomains");
    }

    @Test
    void urlsBuiltFromTheRequestSayHttpsWithNoPort() throws IOException {
        String metadata = get("/.well-known/oauth-protected-resource");
        String refused = get("/api/v1/contact-messages");

        assertThat(metadata).startsWith("HTTP/1.1 200 ");
        assertThat(metadata).contains("\"resource\":\"https://" + HOST + "\"");
        assertThat(refused).startsWith("HTTP/1.1 401 ");
        assertThat(head(refused)).contains(
            "resource_metadata=\"https://" + HOST + "/.well-known/oauth-protected-resource\"");
    }
}
