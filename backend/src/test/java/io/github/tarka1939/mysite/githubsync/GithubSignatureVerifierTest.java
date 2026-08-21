package io.github.tarka1939.mysite.githubsync;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.charset.StandardCharsets;
import java.util.HexFormat;
import java.util.Set;
import java.util.stream.Collectors;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullSource;
import org.junit.jupiter.params.provider.ValueSource;

import com.tngtech.archunit.core.domain.JavaClass;
import com.tngtech.archunit.core.importer.ClassFileImporter;

class GithubSignatureVerifierTest {

    /**
     * GitHub's own published example (from its webhook documentation), not a value this test
     * computed for itself. That matters: a self-consistent test -- sign with our code, verify
     * with our code -- passes just as happily if the algorithm, encoding or key handling is
     * subtly not what GitHub does. This vector fails unless the digest matches GitHub's.
     */
    private static final String GITHUB_DOC_SECRET = "It's a Secret to Everybody";
    private static final byte[] GITHUB_DOC_PAYLOAD = "Hello, World!".getBytes(StandardCharsets.UTF_8);
    private static final String GITHUB_DOC_SIGNATURE =
        "sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17";

    private static final String SECRET = "a-sufficiently-long-test-webhook-secret";

    private final GithubSignatureVerifier verifier = new GithubSignatureVerifier(SECRET);

    private static String sign(String secret, byte[] body) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            return "sha256=" + HexFormat.of().formatHex(mac.doFinal(body));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    @Test
    void matchesGithubsOwnPublishedTestVector() {
        GithubSignatureVerifier docVerifier = new GithubSignatureVerifier(GITHUB_DOC_SECRET);

        assertThat(docVerifier.isValid(GITHUB_DOC_PAYLOAD, GITHUB_DOC_SIGNATURE)).isTrue();
    }

    @Test
    void acceptsACorrectlySignedPayload() {
        byte[] body = "{\"action\":\"opened\"}".getBytes(StandardCharsets.UTF_8);

        assertThat(verifier.isValid(body, sign(SECRET, body))).isTrue();
    }

    /**
     * The raw-bytes requirement, made falsifiable.
     *
     * <p>This payload is semantically identical to its compact form but formatted the way no
     * serialiser would emit it: newlines, odd indentation, keys out of alphabetical order, a
     * unicode escape, and a trailing space inside a string. If any layer between the socket and
     * {@link GithubSignatureVerifier} parsed and re-emitted the body, these bytes would change
     * and this assertion would fail. It is the test that would have caught the mistake of
     * signing a re-serialised body in the test itself -- because here the signed bytes and the
     * verified bytes are the same array, and the array is one no round trip could produce.
     */
    @Test
    void verifiesTheExactBytesSigned_notASemanticallyEqualReserialisation() {
        byte[] awkward = ("{\n"
            + "    \"zeta\" :   1,\n"
            + "  \"repository\": {\"full_name\":\"tarka1939/My_Site\"},\n"
            + "\t\"alpha\": \"tr\\u00e4iling space \"\n"
            + "}\n").getBytes(StandardCharsets.UTF_8);

        String signature = sign(SECRET, awkward);

        assertThat(verifier.isValid(awkward, signature)).isTrue();

        // And the compact, key-sorted form of the same data -- what a re-serialisation would
        // most plausibly produce -- does NOT verify against that signature.
        byte[] reserialised =
            "{\"alpha\":\"träiling space \",\"repository\":{\"full_name\":\"tarka1939/My_Site\"},\"zeta\":1}"
                .getBytes(StandardCharsets.UTF_8);
        assertThat(verifier.isValid(reserialised, signature)).isFalse();
    }

    @Test
    void rejectsASignatureForADifferentBody() {
        byte[] signedBody = "{\"action\":\"opened\"}".getBytes(StandardCharsets.UTF_8);
        byte[] tamperedBody = "{\"action\":\"closed\"}".getBytes(StandardCharsets.UTF_8);

        assertThat(verifier.isValid(tamperedBody, sign(SECRET, signedBody))).isFalse();
    }

    @Test
    void rejectsASignatureMadeWithADifferentSecret() {
        byte[] body = "{\"action\":\"opened\"}".getBytes(StandardCharsets.UTF_8);

        assertThat(verifier.isValid(body, sign("a-completely-different-webhook-secret", body))).isFalse();
    }

    @Test
    void acceptsAnUppercaseHexSignature() {
        byte[] body = "{\"action\":\"opened\"}".getBytes(StandardCharsets.UTF_8);
        String upper = "sha256=" + sign(SECRET, body).substring("sha256=".length()).toUpperCase();

        assertThat(verifier.isValid(body, upper)).isTrue();
    }

    @ParameterizedTest(name = "rejects malformed signature header: [{0}]")
    @NullSource
    @ValueSource(strings = {
        "",
        "   ",
        // Right digest, missing the algorithm prefix.
        "757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17",
        // The legacy SHA-1 header's scheme. Accepting this would be a downgrade.
        "sha1=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17",
        "sha256=",
        "sha256=deadbeef",
        // 64 characters, but not hex.
        "sha256=zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz",
        // 65 hex characters.
        "sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e177",
    })
    void rejectsAMalformedOrAbsentSignatureHeader(String signatureHeader) {
        byte[] body = "Hello, World!".getBytes(StandardCharsets.UTF_8);

        assertThat(verifier.isValid(body, signatureHeader)).isFalse();
    }

    @Nested
    class SecretValidation {

        @ParameterizedTest(name = "refuses to construct with secret [{0}]")
        @NullSource
        @ValueSource(strings = {"", "   ", "\t\n"})
        void refusesAnAbsentSecret(String secret) {
            assertThatThrownBy(() -> new GithubSignatureVerifier(secret))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("app.github-sync.webhook-secret");
        }

        @Test
        void refusesASecretShorterThanTheGuessabilityFloor() {
            String tooShort = "x".repeat(GithubSignatureVerifier.MIN_SECRET_LENGTH - 1);

            assertThatThrownBy(() -> new GithubSignatureVerifier(tooShort))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining(String.valueOf(GithubSignatureVerifier.MIN_SECRET_LENGTH));
        }

        @Test
        void acceptsASecretAtExactlyTheFloor() {
            String atFloor = "x".repeat(GithubSignatureVerifier.MIN_SECRET_LENGTH);

            assertThat(new GithubSignatureVerifier(atFloor)).isNotNull();
        }
    }

    /**
     * A timing property cannot be observed by a functional test: swapping
     * {@link java.security.MessageDigest#isEqual} for {@code Arrays.equals} changes no return
     * value of any test above, only how long a wrong answer takes to arrive. So this asserts on
     * the compiled bytecode's call targets instead, via ArchUnit (already on the classpath,
     * transitively through spring-modulith). It is an unusual shape for a test and it is here
     * deliberately -- without it, the constant-time comparison is an unenforced comment, and
     * the next person to "simplify" it would get a green suite.
     */
    @Test
    void comparesDigestsInConstantTime() {
        JavaClass verifierClass = new ClassFileImporter()
            .importClasses(GithubSignatureVerifier.class)
            .get(GithubSignatureVerifier.class);

        Set<String> callTargets = verifierClass.getMethodCallsFromSelf().stream()
            .map(call -> call.getTargetOwner().getFullName() + "." + call.getName())
            .collect(Collectors.toSet());

        assertThat(callTargets)
            .as("GithubSignatureVerifier must compare digests with MessageDigest.isEqual, "
                + "which does not short-circuit on the first differing byte")
            .contains("java.security.MessageDigest.isEqual");

        assertThat(callTargets)
            .as("no short-circuiting comparison may be used on signature material")
            .doesNotContain(
                "java.util.Arrays.equals",
                "java.lang.String.equals",
                "java.lang.String.equalsIgnoreCase",
                "java.util.Objects.equals",
                "java.lang.String.contentEquals");
    }
}
