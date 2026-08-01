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
        // Deliberately just getRemoteAddr(), not X-Forwarded-For: X-Forwarded-For is
        // caller-controlled unless the app sits behind a known, trusted reverse proxy that
        // strips/overwrites client-supplied values before setting its own -- no such proxy
        // exists yet (Phase 5, VPS hosting, not decided). Trusting it now would let any caller
        // spoof the header and trivially bypass per-IP rate limiting. Revisit once Phase 5
        // picks a reverse proxy and wires up Spring's forwarded-header support
        // (server.forward-headers-strategy / ForwardedHeaderFilter) with a trusted proxy count.
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
