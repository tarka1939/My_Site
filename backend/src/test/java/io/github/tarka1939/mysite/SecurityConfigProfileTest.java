package io.github.tarka1939.mysite;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * Regression test for the exact bug class caught only by manual curl + review during Phase 1:
 * an inverted {@code @Profile} predicate on {@link SecurityConfig} that failed open instead of
 * closed. Asserts actual HTTP behavior per profile rather than relying on re-checking by hand
 * every time the config changes.
 */
@Testcontainers
class SecurityConfigProfileTest {

    @Container
    @ServiceConnection
    static PostgreSQLContainer postgres = new PostgreSQLContainer("postgres:17-alpine");

    @Nested
    @SpringBootTest
    @AutoConfigureMockMvc
    @ActiveProfiles("prod")
    class ProdProfile {

        @Autowired
        private MockMvc mockMvc;

        @Test
        void actuatorHealthIsPermitted() throws Exception {
            mockMvc.perform(get("/actuator/health"))
                .andExpect(status().isOk());
        }

        @Test
        void apiWritesAreDenied() throws Exception {
            mockMvc.perform(post("/api/v1/projects")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("{\"title\":\"x\",\"description\":\"x\",\"tags\":[]}"))
                .andExpect(status().isForbidden());
        }
    }

    @Nested
    @SpringBootTest
    @AutoConfigureMockMvc
    @ActiveProfiles("dev")
    class DevProfile {

        @Autowired
        private MockMvc mockMvc;

        @Test
        void apiWritesArePermitted() throws Exception {
            // An empty body is enough to prove the request reached the controller (and failed
            // Bean Validation) rather than being blocked by Security -- a 403 here would mean
            // the dev permit-all chain regressed, a 400 proves it let the request through.
            mockMvc.perform(post("/api/v1/projects")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("{}"))
                .andExpect(status().isBadRequest());
        }
    }

    /**
     * No {@code @ActiveProfiles} at all -- the exact scenario {@link SecurityConfig}'s own
     * Javadoc calls out as the motivating risk: a deploy that forgets to pass
     * {@code -Dspring-boot.run.profiles} (dev or prod) must still fail closed, not fall back
     * to permit-all. Only {@code dev} opts into permit-all; everything else, including no
     * profile set, gets the locked-down chain.
     */
    @Nested
    @SpringBootTest
    @AutoConfigureMockMvc
    class NoProfile {

        @Autowired
        private MockMvc mockMvc;

        @Test
        void apiWritesAreDeniedByDefault() throws Exception {
            mockMvc.perform(post("/api/v1/projects")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("{\"title\":\"x\",\"description\":\"x\",\"tags\":[]}"))
                .andExpect(status().isForbidden());
        }

        @Test
        void actuatorHealthIsStillPermitted() throws Exception {
            mockMvc.perform(get("/actuator/health"))
                .andExpect(status().isOk());
        }
    }
}
