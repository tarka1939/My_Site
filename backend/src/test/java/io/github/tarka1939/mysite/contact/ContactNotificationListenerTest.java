package io.github.tarka1939.mysite.contact;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

import java.time.Instant;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.web.client.RestClientException;

import io.github.tarka1939.mysite.ResendEmailClient;

@ExtendWith(MockitoExtension.class)
class ContactNotificationListenerTest {

    private static final String OWNER = "owner@example.invalid";

    @Mock
    private ResendEmailClient resendEmailClient;

    @Test
    void configuredAddress_sendsNotificationContainingTheSubmission() {
        ContactMessageReceivedEvent event = event("Alice", "alice@example.invalid", "Hello there");

        listener(OWNER).onContactMessageReceived(event);

        String[] sent = capturedArguments();
        assertThat(sent[0]).isEqualTo(OWNER);
        assertThat(sent[1]).isEqualTo("New contact message from Alice");
        assertThat(sent[2])
            .contains("Alice")
            .contains("alice@example.invalid")
            .contains("Hello there")
            .contains(event.messageId().toString())
            .contains("2026-09-03T10:15:30Z");
    }

    @Test
    void blankAddress_skipsSendAndDoesNotThrow() {
        // The designed no-op: nobody has said where notifications go. The message is already
        // committed by the time this runs, so skipping costs a notification, not the message.
        ContactNotificationListener listener = listener("   ");

        assertThatCode(() -> listener.onContactMessageReceived(event("Alice", "a@example.invalid", "Hi")))
            .doesNotThrowAnyException();

        verify(resendEmailClient, never()).sendContactNotificationEmail(anyString(), anyString(), anyString());
    }

    @Test
    void emailClientThrows_isSwallowedSoTheCallerIsNeverAffected() {
        // The point of the exercise. AGENT_LOG.md records this exact shape shipping once in
        // PasswordResetService.requestReset, where an uncaught Resend failure changed the HTTP
        // response. Here it must not even be visible to the publisher.
        doThrow(new RestClientException("resend is down"))
            .when(resendEmailClient).sendContactNotificationEmail(anyString(), anyString(), anyString());

        ContactNotificationListener listener = listener(OWNER);

        assertThatCode(() -> listener.onContactMessageReceived(event("Alice", "a@example.invalid", "Hi")))
            .doesNotThrowAnyException();
    }

    @Test
    void visitorMarkupInTheBodyIsEscapedRatherThanRendered() {
        listener(OWNER).onContactMessageReceived(event(
            "Mallory", "m@example.invalid",
            "</blockquote><a href=\"https://evil.invalid\">Click me</a> & 'quoted'"));

        String body = sentBody();
        // The literal markup the visitor typed must survive as text. If any of these strings
        // appeared unescaped, the visitor would control the structure of a mail the owner reads
        // in an HTML-rendering client -- a phishing vector, not a formatting glitch.
        assertThat(body).doesNotContain("<a href=");
        assertThat(body).doesNotContain("</blockquote><a");
        assertThat(body).contains("&lt;/blockquote&gt;&lt;a href=&quot;https://evil.invalid&quot;&gt;");
        assertThat(body).contains("&amp;");
        assertThat(body).contains("&#39;quoted&#39;");
        // Exactly one blockquote element, opened and closed by us.
        assertThat(countOccurrences(body, "<blockquote>")).isEqualTo(1);
        assertThat(countOccurrences(body, "</blockquote>")).isEqualTo(1);
    }

    @Test
    void escapingHappensBeforeLineBreaksAreIntroduced() {
        listener(OWNER).onContactMessageReceived(event(
            "Alice", "a@example.invalid", "first<br>still-first\r\nsecond\rthird\nfourth"));

        String body = sentBody();
        // A <br> the visitor typed is escaped; the three real line terminators (CRLF, bare CR,
        // bare LF) each become exactly one <br>. Escaping in the other order would let the
        // typed one through.
        assertThat(body).contains("first&lt;br&gt;still-first");
        assertThat(countOccurrences(body, "<br>")).isEqualTo(3);
    }

    @Test
    void controlCharactersAreStrippedFromTheSubjectLine() {
        // The subject is the one value that becomes a MIME header. A smuggled CRLF is the
        // classic header-injection primitive; strip it here rather than trust Resend to.
        listener(OWNER).onContactMessageReceived(event(
            "Mallory\r\nBcc: victim@example.invalid\r\nSubject: Free money",
            "m@example.invalid", "Hi"));

        String subject = sentSubject();
        assertThat(subject).doesNotContain("\r").doesNotContain("\n");
        assertThat(subject).isEqualTo(
            "New contact message from MalloryBcc: victim@example.invalidSubject: Free money");
    }

    @Test
    void overlongNameIsTruncatedInTheSubjectLine() {
        listener(OWNER).onContactMessageReceived(
            event("N".repeat(200), "a@example.invalid", "Hi"));

        assertThat(sentSubject()).isEqualTo("New contact message from " + "N".repeat(100));
    }

    @Test
    void truncationDoesNotSplitAnAstralCharacterInHalf() {
        // U+1F600 GRINNING FACE is one code point and two chars. Truncating by char at 100 cut
        // one of them in half and left a lone high surrogate, which Jackson emits as a literal
        // escape sequence instead of throwing -- mojibake in the owner's subject line, and
        // nothing anywhere reporting it. Written as a code point rather than as a pair of Java
        // escapes so that the test source cannot itself contain the half-character it forbids.
        //
        // The single leading "N" is load-bearing. All-emoji input would have the old char-based
        // truncation land on char 100, which is a pair BOUNDARY -- 50 whole emoji, no split, and
        // a test that passes against the bug. Shifting everything by one char makes the cut fall
        // inside the 50th pair, which is the case that was broken.
        String emoji = Character.toString(0x1F600);

        listener(OWNER).onContactMessageReceived(
            event("N" + emoji.repeat(120), "a@example.invalid", "Hi"));

        String subject = sentSubject();
        assertThat(subject).isEqualTo("New contact message from N" + emoji.repeat(99));
        // codePoints(), not chars(): chars() walks UTF-16 code units, so BOTH halves of a
        // perfectly valid pair are surrogates by that measure and the assertion would fail on
        // correct output. codePoints() combines a valid pair into one non-surrogate code point
        // and yields an unpaired one as itself, which is exactly the distinction being asserted.
        assertThat(subject.codePoints()
            .noneMatch(cp -> cp >= Character.MIN_SURROGATE && cp <= Character.MAX_SURROGATE))
            .as("no unpaired surrogate may survive truncation")
            .isTrue();
    }

    @Test
    void anUnpairedSurrogateInTheNameIsDroppedRatherThanForwarded() {
        // Not reachable through a well-formed JSON body, but this sanitizer is the last thing
        // between visitor input and a MIME header, and that is the wrong place to assume the
        // input is well-formed.
        String loneHighSurrogate = String.valueOf((char) 0xD83D);

        listener(OWNER).onContactMessageReceived(
            event("Ali" + loneHighSurrogate + "ce", "a@example.invalid", "Hi"));

        assertThat(sentSubject()).isEqualTo("New contact message from Alice");
    }

    @Test
    void malformedConfiguredAddressFailsFastAtBeanCreation() {
        // Present-but-malformed, the other half of CLAUDE.md's config-validation rule. Each of
        // these would otherwise fail silently, one undelivered notification at a time.
        for (String bad : new String[] {
            "not-an-email",
            "@example.invalid",
            "owner@",
            "owner@example.invalid, attacker@evil.invalid",
            "owner@example.invalid;attacker@evil.invalid",
            "owner @example.invalid",
            "owner@a.invalid\r\nBcc: attacker@evil.invalid",
            "two@at@example.invalid"
        }) {
            assertThatThrownBy(() -> listener(bad))
                .as("address %s", bad)
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("app.contact.notification-email");
        }
    }

    @Test
    void wellFormedAddressIsAcceptedAtBeanCreation() {
        assertThatCode(() -> listener("owner+contact@sub.example.invalid")).doesNotThrowAnyException();
        assertThatCode(() -> listener("")).doesNotThrowAnyException();
        assertThatCode(() -> listener(null)).doesNotThrowAnyException();
    }

    private ContactNotificationListener listener(String notificationAddress) {
        return new ContactNotificationListener(resendEmailClient, notificationAddress);
    }

    private static ContactMessageReceivedEvent event(String name, String email, String message) {
        return new ContactMessageReceivedEvent(
            UUID.randomUUID(), Instant.parse("2026-09-03T10:15:30Z"), name, email, message);
    }

    private String sentSubject() {
        return capturedArguments()[1];
    }

    private String sentBody() {
        return capturedArguments()[2];
    }

    private String[] capturedArguments() {
        ArgumentCaptor<String> to = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> subject = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> body = ArgumentCaptor.forClass(String.class);
        verify(resendEmailClient).sendContactNotificationEmail(
            to.capture(), subject.capture(), body.capture());
        return new String[] {to.getValue(), subject.getValue(), body.getValue()};
    }

    private static int countOccurrences(String haystack, String needle) {
        int count = 0;
        for (int i = haystack.indexOf(needle); i >= 0; i = haystack.indexOf(needle, i + needle.length())) {
            count++;
        }
        return count;
    }
}
