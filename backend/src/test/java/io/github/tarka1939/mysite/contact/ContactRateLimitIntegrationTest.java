package io.github.tarka1939.mysite.contact;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

import io.github.tarka1939.mysite.TestPostgres;

/**
 * The contact form's rate limit over HTTP, after #309 moved it from a count of stored rows into
 * the shared {@code InMemoryRateLimiter}.
 *
 * <p>Two things are pinned here. The first is that a visitor sees exactly what they saw before
 * the move: the same five-per-hour budget, and the same 429 problem body with no
 * {@code Retry-After}. The second is the shared-limiter rule in CLAUDE.md's checklist, which
 * this project has already broken once (login and password reset briefly shared a bucket, see
 * AGENT_LOG.md): the contact key must not collide with login's or password reset's for the same
 * IP, in either direction. Both are asserted through the real endpoints rather than against the
 * limiter, because the prefixes live in three services and a collision is a fact about all of
 * them together.
 *
 * <p>MockMvc rather than a real port, so each test can choose the requester's address: every
 * test takes fresh TEST-NET-3 addresses, because the limiter is a singleton in the cached context
 * and outlives each test.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Testcontainers
@ActiveProfiles("test")
class ContactRateLimitIntegrationTest {

    /** ContactService's budget, the same as the row count enforced before #309. */
    private static final int MAX_MESSAGES_PER_HOUR = 5;

    /** AuthService's and PasswordResetService.requestReset's budgets. */
    private static final int MAX_LOGIN_ATTEMPTS = 5;
    private static final int MAX_RESET_REQUESTS = 5;

    /** TEST-NET-3, from .10 up; the trusted proxy block (198.51.100.0/24) is never handed out. */
    private static final AtomicInteger NEXT_ADDRESS = new AtomicInteger(10);

    @Container
    @ServiceConnection
    static PostgreSQLContainer postgres = TestPostgres.container();

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ContactMessageRepository contactMessageRepository;

    @Test
    void theMessagePastTheBudget_is429WithTheSameProblemBodyAsBefore_andIsNotStored() throws Exception {
        String address = nextAddress();
        for (int i = 0; i < MAX_MESSAGES_PER_HOUR; i++) {
            submitContact(address, "budget@example.invalid").andExpect(status().isCreated());
        }
        long stored = contactMessageRepository.count();

        submitContact(address, "budget@example.invalid")
            .andExpect(status().isTooManyRequests())
            .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
            .andExpect(jsonPath("$.status").value(429))
            .andExpect(jsonPath("$.title").value("Too Many Requests"))
            .andExpect(jsonPath("$.detail").value("Too many contact messages from this requester"))
            // There never was one. Pinned so that adding it is a decision, not a side effect.
            .andExpect(header().doesNotExist(HttpHeaders.RETRY_AFTER));

        assertThat(contactMessageRepository.count()).as("the refused message was not stored").isEqualTo(stored);
    }

    @Test
    void oneClientsSpentBudget_leavesAnotherClientsAlone() throws Exception {
        String spent = nextAddress();
        exhaustContact(spent);

        submitContact(nextAddress(), "other@example.invalid").andExpect(status().isCreated());
    }

    /**
     * The one behaviour that did change, on purpose. The row count used to be refunded when the
     * owner deleted messages; the in-memory budget is not, because it no longer has anything to do
     * with what is stored. The E2E contact journeys relied on that refund.
     */
    @Test
    void deletingTheStoredMessages_doesNotRefundTheBudget() throws Exception {
        String address = nextAddress();
        exhaustContact(address, "refund@example.invalid");

        List<ContactMessage> mine = contactMessageRepository.findAll().stream()
            .filter(message -> message.getEmail().equals("refund@example.invalid"))
            .toList();
        assertThat(mine).hasSize(MAX_MESSAGES_PER_HOUR);
        contactMessageRepository.deleteAll(mine);

        submitContact(address, "refund@example.invalid").andExpect(status().isTooManyRequests());
    }

    @Test
    void exhaustingTheContactBudget_leavesLoginAndPasswordResetAlone() throws Exception {
        String address = nextAddress();
        exhaustContact(address);

        // One request each is enough to tell: had either shared the contact bucket, it would now
        // find five hits inside its window and refuse with a 429 instead.
        login(address).andExpect(status().isUnauthorized());
        requestPasswordReset(address).andExpect(status().isAccepted());
    }

    @Test
    void exhaustingLogin_leavesTheContactBudgetAlone() throws Exception {
        String address = nextAddress();
        for (int i = 0; i < MAX_LOGIN_ATTEMPTS; i++) {
            login(address).andExpect(status().isUnauthorized());
        }
        login(address).andExpect(status().isTooManyRequests());

        submitContact(address, "after-login@example.invalid").andExpect(status().isCreated());
    }

    @Test
    void exhaustingPasswordReset_leavesTheContactBudgetAlone() throws Exception {
        String address = nextAddress();
        for (int i = 0; i < MAX_RESET_REQUESTS; i++) {
            requestPasswordReset(address).andExpect(status().isAccepted());
        }
        requestPasswordReset(address).andExpect(status().isTooManyRequests());

        submitContact(address, "after-reset@example.invalid").andExpect(status().isCreated());
    }

    private void exhaustContact(String address) throws Exception {
        exhaustContact(address, "flooder@example.invalid");
    }

    /** Spends the whole budget and proves it is spent, so a later 2xx means a different bucket. */
    private void exhaustContact(String address, String email) throws Exception {
        for (int i = 0; i < MAX_MESSAGES_PER_HOUR; i++) {
            submitContact(address, email).andExpect(status().isCreated());
        }
        submitContact(address, email).andExpect(status().isTooManyRequests());
    }

    private ResultActions submitContact(String address, String email) throws Exception {
        return mockMvc.perform(post("/api/v1/contact")
            .contentType(MediaType.APPLICATION_JSON)
            .content("{\"name\":\"Visitor\",\"email\":\"" + email + "\",\"message\":\"Hello\"}")
            .with(from(address)));
    }

    /** A login for an account that does not exist: 401 while the budget lasts, 429 after. */
    private ResultActions login(String address) throws Exception {
        return mockMvc.perform(post("/api/v1/auth/login")
            .contentType(MediaType.APPLICATION_JSON)
            .content("{\"username\":\"nobody\",\"password\":\"not-a-password\"}")
            .with(from(address)));
    }

    /** For an address no account has, so nothing is mailed: 202 while the budget lasts, 429 after. */
    private ResultActions requestPasswordReset(String address) throws Exception {
        return mockMvc.perform(post("/api/v1/auth/password-reset-request")
            .contentType(MediaType.APPLICATION_JSON)
            .content("{\"email\":\"nobody@example.invalid\"}")
            .with(from(address)));
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
}
