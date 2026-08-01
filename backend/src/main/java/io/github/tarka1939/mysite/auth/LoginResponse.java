package io.github.tarka1939.mysite.auth;

import java.time.Instant;

public record LoginResponse(String token, Instant expiresAt) {
}
