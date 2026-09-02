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

    private final ClientIpResolver clientIpResolver;

    public ClientIpHasher(ClientIpResolver clientIpResolver) {
        this.clientIpResolver = clientIpResolver;
    }

    public String hashOf(HttpServletRequest request) {
        // Which address counts as "the requester" is a trust decision, not a hashing one, and it
        // stopped being a one-liner when Phase 5 put two reverse proxies in front of this app
        // (issue #168): getRemoteAddr() is now the innermost proxy, identically for the whole
        // internet. ClientIpResolver owns that decision and the trust boundary it turns on; this
        // class stays responsible only for never storing a raw address. With no proxy configured
        // the resolver returns getRemoteAddr(), which is exactly what this method used to do --
        // the header is read on a deployment that says it has a proxy, and nowhere else.
        return sha256Hex(clientIpResolver.resolve(request));
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
