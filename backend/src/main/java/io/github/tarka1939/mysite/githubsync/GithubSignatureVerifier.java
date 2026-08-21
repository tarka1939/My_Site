package io.github.tarka1939.mysite.githubsync;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.util.HexFormat;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/**
 * Verifies GitHub's {@code X-Hub-Signature-256} header against the raw bytes of a webhook
 * delivery. This is the only thing standing between a public, unauthenticated URL and this
 * application's database, so its two easy-to-get-wrong properties are spelled out here.
 *
 * <p><b>Raw bytes, never a re-serialised object.</b> GitHub HMACs the exact octets it puts on
 * the wire. A body that has been parsed into a DTO and written back out is a <i>different</i>
 * byte sequence -- key order, whitespace, number formatting and Unicode escaping are all free
 * choices that Jackson makes differently from Ruby -- and its HMAC will not match. Worse, a
 * test that builds its payload by serialising an object and then signs <i>that</i> string will
 * pass while production fails, because the test never exercises the mismatch. So this class
 * takes {@code byte[]} and nothing else, the controller reads those bytes straight off the
 * servlet input stream with no message converter in the path, and
 * {@code GithubSignatureVerifierTest} signs a deliberately awkwardly-formatted payload that
 * could not survive a round trip.
 *
 * <p><b>Constant-time comparison.</b> {@code String.equals}, {@code Arrays.equals} and
 * {@code Objects.equals} all return as soon as they find a differing byte, which leaks how many
 * leading bytes of a guess were correct and makes the signature forgeable one byte at a time.
 * {@link MessageDigest#isEqual} exists precisely for this and is length-safe as well. Nothing
 * about the behaviour of this class changes if that call is swapped for a short-circuiting one,
 * which is why {@code GithubSignatureVerifierTest} asserts on the bytecode's call targets --
 * a functional test cannot observe a timing property.
 */
public class GithubSignatureVerifier {

    private static final String HMAC_ALGORITHM = "HmacSHA256";
    private static final String SIGNATURE_PREFIX = "sha256=";

    /** SHA-256 is 32 bytes, so 64 hex characters. */
    private static final int HEX_DIGEST_LENGTH = 64;

    /**
     * A policy floor, not a cryptographic one -- deliberately a weaker claim than
     * {@code SecurityConfig}'s 32-byte JWT check, which enforces a real HS256 requirement.
     * HMAC-SHA256 accepts a key of any length (it pads or hashes it), so nothing breaks with a
     * short secret except its guessability. GitHub's own webhook documentation recommends a
     * long random string; this rejects the "secret123" case at startup rather than serving a
     * receiver anyone can forge deliveries for.
     */
    static final int MIN_SECRET_LENGTH = 16;

    private final SecretKeySpec key;

    /**
     * @throws IllegalStateException if the configured secret is absent or too short. This bean
     *     is only created when {@code app.github-sync.enabled} is true, so reaching this
     *     constructor at all means someone asked for a live receiver -- see
     *     {@link GithubSyncConfiguration} for why that is a boot failure rather than a warning.
     */
    GithubSignatureVerifier(String webhookSecret) {
        if (webhookSecret == null || webhookSecret.isBlank()) {
            throw new IllegalStateException(
                "app.github-sync.enabled is true but app.github-sync.webhook-secret "
                    + "(GITHUB_WEBHOOK_SECRET) is not set. A receiver with no secret cannot verify "
                    + "anything, so every request to it would have to be either rejected or trusted. "
                    + "Set the secret, or set app.github-sync.enabled=false to leave the endpoint "
                    + "unmapped.");
        }
        if (webhookSecret.length() < MIN_SECRET_LENGTH) {
            throw new IllegalStateException(
                "app.github-sync.webhook-secret (GITHUB_WEBHOOK_SECRET) must be at least "
                    + MIN_SECRET_LENGTH + " characters; got " + webhookSecret.length()
                    + ". This is a guessability floor, not an HMAC-SHA256 requirement.");
        }
        this.key = new SecretKeySpec(webhookSecret.getBytes(StandardCharsets.UTF_8), HMAC_ALGORITHM);
    }

    /**
     * @param rawBody the exact bytes received, before any parsing
     * @param signatureHeader the raw {@code X-Hub-Signature-256} value, or {@code null} if the
     *     header was absent -- absent is not a special case here, it is simply invalid
     * @return whether the signature matches. Every failure mode -- no header, wrong prefix,
     *     wrong length, non-hex characters, correct shape but wrong digest -- returns false
     *     rather than throwing, so the caller has exactly one rejection path to get right.
     */
    public boolean isValid(byte[] rawBody, String signatureHeader) {
        if (rawBody == null || signatureHeader == null) {
            return false;
        }
        // Only the SHA-256 header is accepted. GitHub still sends the legacy SHA-1
        // X-Hub-Signature alongside it; falling back to that when this one is missing would
        // hand an attacker a downgrade, so there is deliberately no fallback anywhere here.
        if (!signatureHeader.startsWith(SIGNATURE_PREFIX)) {
            return false;
        }
        String providedHex = signatureHeader.substring(SIGNATURE_PREFIX.length());
        if (providedHex.length() != HEX_DIGEST_LENGTH) {
            return false;
        }

        byte[] providedDigest;
        try {
            // Case-insensitive; GitHub sends lowercase but comparing decoded bytes rather than
            // hex text means a correct signature in uppercase would still verify, instead of
            // failing for a reason that would be very hard to diagnose from the outside.
            providedDigest = HexFormat.of().parseHex(providedHex);
        } catch (IllegalArgumentException notHex) {
            return false;
        }

        return MessageDigest.isEqual(expectedDigest(rawBody), providedDigest);
    }

    private byte[] expectedDigest(byte[] rawBody) {
        try {
            // A new Mac per call: Mac is stateful and not thread-safe, and this is invoked from
            // whatever container thread the delivery landed on.
            Mac mac = Mac.getInstance(HMAC_ALGORITHM);
            mac.init(key);
            return mac.doFinal(rawBody);
        } catch (GeneralSecurityException e) {
            // HmacSHA256 is a required JCE algorithm and the key was validated at construction,
            // so this is unreachable rather than a case to degrade through.
            throw new IllegalStateException("HMAC-SHA256 unavailable or key rejected", e);
        }
    }
}
