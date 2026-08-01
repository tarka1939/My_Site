package io.github.tarka1939.mysite;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;

import org.springframework.stereotype.Component;

import jakarta.servlet.http.HttpServletRequest;

/**
 * Resolves the requester's IP and hashes it (SHA-256 hex) — used anywhere a requester needs
 * to be rate-limited without storing a raw IP (see docs/DATA_MODEL.md: ContactMessage's
 * requester_ip_hash, same principle applied to password-reset-request).
 */
@Component
public class ClientIpHasher {

    public String hashOf(HttpServletRequest request) {
        return sha256Hex(resolveClientIp(request));
    }

    private String resolveClientIp(HttpServletRequest request) {
        // A reverse proxy in front of the app (see docs/DECISIONS.md's VPS hosting ADR) will
        // set X-Forwarded-For; the first entry is the original client. Falls back to the
        // socket address directly when there's no proxy (e.g. local dev).
        String forwardedFor = request.getHeader("X-Forwarded-For");
        if (forwardedFor != null && !forwardedFor.isBlank()) {
            return forwardedFor.split(",")[0].trim();
        }
        return request.getRemoteAddr();
    }

    private String sha256Hex(String value) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(value.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(hash);
        } catch (NoSuchAlgorithmException e) {
            // SHA-256 is a mandatory JDK algorithm (JLS/JCA baseline) -- this is unreachable.
            throw new IllegalStateException("SHA-256 not available", e);
        }
    }
}
