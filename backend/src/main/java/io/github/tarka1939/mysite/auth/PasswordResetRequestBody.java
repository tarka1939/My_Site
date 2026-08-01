package io.github.tarka1939.mysite.auth;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record PasswordResetRequestBody(
    @NotBlank @Email @Size(max = 320) String email
) {
}
