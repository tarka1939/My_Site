package io.github.tarka1939.mysite.contact;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

import io.github.tarka1939.mysite.ResendEmailClient;

/**
 * Emails the site owner when the contact form is used. Issue #186 — before this, submissions sat
 * in the database until someone thought to open the admin panel.
 *
 * <h2>Why this runs after the commit, on another thread, and swallows its own failures</h2>
 *
 * <p>Notification is best-effort; persistence is not. A contact message is the product, and losing
 * one because a third-party API had a bad minute is the worst outcome available here. So:
 *
 * <ul>
 *   <li>{@code AFTER_COMMIT} — the row is durable before anyone tries to send anything, and a
 *       send failure has no transaction left to roll back.</li>
 *   <li>{@code @Async("taskExecutor")} — a slow or hanging Resend call must not hold the visitor's
 *       HTTP response open. The executor is the one AsyncConfig provisions.</li>
 *   <li>{@code catch (RuntimeException)} — belt and braces. An exception on the async thread
 *       cannot reach the publisher anyway, but catching it here is what makes the intent
 *       reviewable and lets a unit test assert it directly.</li>
 * </ul>
 *
 * <p>AGENT_LOG.md (2026-08-01 review round) records the same shape shipping once already:
 * {@code PasswordResetService.requestReset} called Resend uncaught inside its
 * {@code @Transactional} method, so a non-2xx changed the HTTP response and reopened the
 * email-enumeration side channel that method exists to close. Same trap, higher stakes.
 */
@Component
public class ContactNotificationListener {

    private static final Logger log = LoggerFactory.getLogger(ContactNotificationListener.class);

    /**
     * The visitor's name goes in the subject line, so it is truncated to something a mail client
     * will actually show. {@code @Size(max = 200)} on the request already bounds it; this bounds
     * it again at the point where the length matters.
     */
    private static final int MAX_SUBJECT_NAME_LENGTH = 100;

    private final ResendEmailClient resendEmailClient;
    private final String notificationAddress;

    public ContactNotificationListener(
        ResendEmailClient resendEmailClient,
        @Value("${app.contact.notification-email:}") String notificationAddress
    ) {
        this.resendEmailClient = resendEmailClient;
        this.notificationAddress = notificationAddress == null ? "" : notificationAddress.trim();

        // CLAUDE.md's config-validation rule, and both halves of it are in play here:
        //
        // ABSENT is a designed no-op. Nothing set means nobody has said where notifications go,
        // which is the state every local dev and every fresh checkout starts in; the listener
        // warns and skips (below) and the message is still saved. Refusing to start would make
        // the contact form un-runnable locally for no safety gain, exactly as it would for
        // RESEND_API_KEY.
        //
        // PRESENT BUT MALFORMED fails fast, right here at bean creation. A typo'd address is
        // invisible at runtime -- the send is attempted, Resend rejects it, the listener logs a
        // warning nobody reads, and the owner concludes the site gets no traffic. That is a worse
        // failure than refusing to boot.
        if (!this.notificationAddress.isEmpty() && !isSingleEmailAddress(this.notificationAddress)) {
            throw new IllegalStateException(
                "app.contact.notification-email must be a single email address with no whitespace "
                    + "or separators; got: " + this.notificationAddress);
        }
    }

    @Async("taskExecutor")
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onContactMessageReceived(ContactMessageReceivedEvent event) {
        if (notificationAddress.isEmpty()) {
            // Deliberate degrade path -- see the constructor. Logs the id and nothing else: the
            // name, email and body are visitor PII and CLAUDE.md keeps them out of the logs at
            // every level, not merely out of the ones enabled in prod. The id is enough, because
            // it points at a row the admin panel can already show.
            log.warn("app.contact.notification-email not configured -- contact message {} saved "
                + "but nobody was notified", event.messageId());
            return;
        }

        try {
            resendEmailClient.sendContactNotificationEmail(
                notificationAddress, subjectFor(event), htmlBodyFor(event));
            log.info("Contact notification email sent for message {}", event.messageId());
        } catch (RuntimeException e) {
            // Must not propagate. The message is already committed; this is the whole point of
            // the class-level note above.
            log.warn("Failed to send contact notification email for message {} -- the message is "
                + "persisted and readable in the admin panel", event.messageId(), e);
        }
    }

    /**
     * The subject is the one field that becomes a MIME header, and it contains visitor-supplied
     * text, so every control character is stripped rather than escaped. Resend is called over
     * JSON, so a newline could not break the request itself — Jackson would encode it — but it
     * would arrive at Resend as a literal newline inside a value destined for a {@code Subject:}
     * header, which is the classic header-injection primitive (a smuggled {@code Bcc:} line).
     * Stripping at this end costs nothing and does not depend on assumptions about theirs.
     */
    private static String subjectFor(ContactMessageReceivedEvent event) {
        return "New contact message from " + sanitizeForHeader(event.visitorName());
    }

    private static String htmlBodyFor(ContactMessageReceivedEvent event) {
        // Every interpolated value except messageId (a UUID) is visitor-controlled and is escaped.
        // Without this, a message body containing "</blockquote><a href=...>" would restructure
        // the mail the owner reads -- and the owner reading it is a human whose mail client
        // renders HTML, which makes it a phishing vector rather than a cosmetic bug.
        return "<p>New contact message from the portfolio site.</p>"
            + "<p><strong>Name:</strong> " + escapeHtml(event.visitorName()) + "</p>"
            + "<p><strong>Email:</strong> " + escapeHtml(event.visitorEmail()) + "</p>"
            + "<p><strong>Received:</strong> " + escapeHtml(String.valueOf(event.receivedAt())) + "</p>"
            + "<p><strong>Message ID:</strong> " + event.messageId() + "</p>"
            + "<blockquote>" + escapeHtmlPreservingLineBreaks(event.message()) + "</blockquote>";
    }

    private static String escapeHtmlPreservingLineBreaks(String value) {
        // Escape FIRST, then introduce the only markup this content is allowed to produce. Doing
        // it the other way round would let a visitor's literal "<br>" survive escaping.
        return escapeHtml(value)
            .replace("\r\n", "\n")
            .replace("\r", "\n")
            .replace("\n", "<br>");
    }

    private static String escapeHtml(String value) {
        // "&" first, or the ampersands introduced by the later replacements get double-escaped.
        return value.replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace("\"", "&quot;")
            .replace("'", "&#39;");
    }

    private static String sanitizeForHeader(String value) {
        StringBuilder sanitized = new StringBuilder(value.length());
        for (int i = 0; i < value.length() && sanitized.length() < MAX_SUBJECT_NAME_LENGTH; i++) {
            char c = value.charAt(i);
            // Drop C0 controls (CR, LF, NUL, ...) and DEL. Ordinary printable characters,
            // including non-ASCII ones, are kept: a name is a name.
            if (c >= ' ' && c != 0x7F) {
                sanitized.append(c);
            }
        }
        return sanitized.toString().trim();
    }

    private static boolean isSingleEmailAddress(String value) {
        int at = value.indexOf('@');
        if (at <= 0 || at != value.lastIndexOf('@') || at == value.length() - 1) {
            return false;
        }
        // Not RFC 5322 -- a structural sanity check, which is all a fail-fast config guard needs
        // to be. It rejects the mistakes that actually happen: whitespace, a control character,
        // and a comma or semicolon smuggling in a second recipient.
        return value.chars().noneMatch(c -> c <= ' ' || c == 0x7F || c == ',' || c == ';');
    }
}
