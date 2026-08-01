package io.github.tarka1939.mysite.auth;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record PasswordResetConfirmBody(
    @NotBlank String token,
    @NotBlank @Size(min = 8) String newPassword
) {
}
