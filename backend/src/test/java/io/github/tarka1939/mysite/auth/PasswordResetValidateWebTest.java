package io.github.tarka1939.mysite.auth;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import io.github.tarka1939.mysite.InvalidResetTokenException;
import io.github.tarka1939.mysite.RateLimitExceededException;

/**
 * Pins the wire shape of {@code POST /api/v1/auth/password-reset/validate} -- the half of issue
 * #187's contract the frontend branches on. {@link AuthIntegrationTest} covers the behaviour
 * (that the token is not consumed, and which tokens are refused); this covers what a client
 * actually receives, which no service-level test can see.
 *
 * <p>The 400 assertions are the reason this file exists. {@code confirmPasswordReset} already
 * rejects a dead token with a {@code token}-keyed field error, and the reset page will branch on
 * that same key for both calls -- so an equivalent-but-differently-shaped 400 here (a bare
 * ProblemDetail, or a different field name) would be a silent trap for whoever writes that code
 * rather than a test failure. Asserting the shape is what stops it drifting.
 */
@WebMvcTest(AuthController.class)
class PasswordResetValidateWebTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private AuthService authService;

    @MockitoBean
    private PasswordResetService passwordResetService;

    @Test
    void usableToken_is204WithNoBody() throws Exception {
        // The service returns normally for a usable token; there is nothing to say beyond
        // "usable", and a body would only invite a client to parse something meaningless.
        mockMvc.perform(post("/api/v1/auth/password-reset/validate")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"token\":\"a-live-token\"}"))
            .andExpect(status().isNoContent())
            .andExpect(content().string(""));
    }

    @Test
    void deadToken_is400WithATokenKeyedFieldError() throws Exception {
        doThrow(new InvalidResetTokenException("Invalid or expired reset token"))
            .when(passwordResetService).validateToken(any(), any());

        mockMvc.perform(post("/api/v1/auth/password-reset/validate")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"token\":\"a-spent-token\"}"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.title").value("Invalid Reset Token"))
            .andExpect(jsonPath("$.detail").value("Invalid or expired reset token"))
            .andExpect(jsonPath("$.errors[0].field").value("token"))
            .andExpect(jsonPath("$.errors[0].message").value("Invalid or expired reset token"));
    }

    @Test
    void blankToken_is400AndStillKeyedToken_withoutReachingTheService() throws Exception {
        // A blank token never gets as far as a lookup (an absent one behaves identically --
        // @NotBlank rejects both, and both key the error to `token`), so it is a plain bean-validation
        // failure rather than an InvalidResetTokenException -- a different title. What matters for
        // the client is that the field key is still "token", so a reset page that has landed its
        // message on that key renders something either way instead of failing silently. (It is not
        // an information leak: distinguishing "you sent no token" from "your token is dead"
        // discloses nothing about any real token.)
        mockMvc.perform(post("/api/v1/auth/password-reset/validate")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"token\":\"   \"}"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.errors[0].field").value("token"));

        verify(passwordResetService, never()).validateToken(any(), any());
    }

    @Test
    void pastTheRateLimit_is429() throws Exception {
        doThrow(new RateLimitExceededException("Too many password reset token checks"))
            .when(passwordResetService).validateToken(any(), any());

        mockMvc.perform(post("/api/v1/auth/password-reset/validate")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"token\":\"a-live-token\"}"))
            .andExpect(status().isTooManyRequests())
            .andExpect(jsonPath("$.title").value("Too Many Requests"));
    }
}
