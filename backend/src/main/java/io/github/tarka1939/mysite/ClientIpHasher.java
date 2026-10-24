package io.github.tarka1939.mysite;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;

import org.springframework.stereotype.Component;

import jakarta.servlet.http.HttpServletRequest;

/**
 * Resolves the requester's IP and hashes it (SHA-256 hex) - the per-client key for the login,
 * both password-reset and contact-form rate limits in {@link InMemoryRateLimiter}, so the
 * limiter's map never holds a raw address. An IPv6 client is its {@code /64}
 * ({@link ClientIpResolver#resolveNetwork}, #314), so rotating addresses inside it does not reset
 * the limit.
 *
 * <p>Not anonymisation. The hash is unsalted, and there are only about 4.3 billion IPv4
 * addresses, so anyone holding one recovers the address by hashing them all. That is fine for a
 * key that lives only in the limiter's memory and dies with the process, and it is why the value
 * must never be written anywhere - a table, a log line, an event. {@code
 * contact_message.requester_ip_hash} stored it until #309, which is the case this paragraph is
 * here to prevent a second time; V10 blanked it. Anything that has to persist a per-visitor
 * identifier wants a secret or discarded salt, as {@code DailyVisitorHasher} uses.
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
        // the resolver uses getRemoteAddr(), which is exactly what this method used to do -- the
        // header is read on a deployment that says it has a proxy, and nowhere else. Since #314
        // an IPv6 address is reduced to its /64 before it gets here.
        return sha256Hex(clientIpResolver.resolveNetwork(request));
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
