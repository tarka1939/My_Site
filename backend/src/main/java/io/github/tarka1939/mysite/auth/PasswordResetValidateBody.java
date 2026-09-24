package io.github.tarka1939.mysite.auth;

import jakarta.validation.constraints.NotBlank;

/**
 * Body of {@code POST /api/v1/auth/password-reset/validate}.
 *
 * <p>The token travels in a body rather than a query parameter on purpose: the deployed backend
 * sits behind Cloudflare and the provider's nginx, both of which log request URLs, so a
 * {@code GET ?token=} would write live reset tokens into two third parties' access logs. See
 * docs/openapi.yaml's validatePasswordResetToken description.
 */
public record PasswordResetValidateBody(
    @NotBlank String token
) {
}
