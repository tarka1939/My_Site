package io.github.tarka1939.mysite.analytics;

import java.time.Duration;
import java.util.Optional;
import java.util.UUID;
import java.util.function.BooleanSupplier;
import java.util.regex.Pattern;

import org.springframework.security.authentication.AnonymousAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;

import io.github.tarka1939.mysite.ClientIpResolver;
import io.github.tarka1939.mysite.InMemoryRateLimiter;
import io.github.tarka1939.mysite.RateLimitExceededException;
import io.github.tarka1939.mysite.analytics.DailyVisitorHasher.VisitorDay;
import io.github.tarka1939.mysite.project.ProjectService;

import jakarta.servlet.http.HttpServletRequest;

/**
 * Turns one well-formed event into at most one row (#58).
 *
 * <p>Every outcome but a 429 is the same 204 to the caller -- stored, already counted today, or
 * dropped for any reason below -- so nothing here returns a value, and nothing the caller can see
 * depends on which happened (the ADR's decision 7). The order of the checks is the design:
 *
 * <ol>
 *   <li><b>Dropped on the request alone</b>, before the address is so much as hashed: a visitor
 *       who asked not to be tracked ({@code DNT: 1}, {@code Sec-GPC: 1}), the admin, and a user
 *       agent that is missing or says it is automation. For the first of these especially, the
 *       right amount of processing of their address is none.</li>
 *   <li><b>The visitor</b>: {@link ClientIpResolver} for the address, as every per-IP decision
 *       here goes through, then {@link DailyVisitorHasher}, which also fixes the day.</li>
 *   <li><b>The rate limit</b>, per visitor.</li>
 *   <li><b>Dropped on what the event names</b>: a project that is not published, or a link URL
 *       that is not exactly one of that project's current links.</li>
 *   <li><b>The insert</b>, {@code ON CONFLICT DO NOTHING}, so a duplicate is a no-op.</li>
 * </ol>
 *
 * <h2>Which drops count against the rate limit</h2>
 * The drops in step 1 do not: they are decided from headers, cost no query, and happen before
 * there is a visitor hash to key on. Everything from step 3 on does, including events dropped in
 * step 4 and duplicates the insert ignores. That is what the limit is for: each of those costs a
 * query or two, and an event naming a random project id or an invented URL costs as much as a real
 * one. Counting them also keeps the 429 independent of whether a project exists, so it cannot be
 * used to probe for drafts.
 *
 * <h2>The project check is a check-then-act, accepted</h2>
 * A project can be unpublished, deleted, or lose a link between the check in step 4 and the
 * insert. The race stores one event for something that was public a moment earlier, which is a
 * true record of a view that happened while it was; a deleted project's rows are kept and shown
 * as deleted by design. Nothing double-applies and nothing private is exposed, so CLAUDE.md's
 * "tolerate it" answer applies rather than "make it atomic".
 */
@Service
@ConditionalOnAnalyticsEnabled
class AnalyticsService {

    /**
     * 60 events a minute per visitor. Generous on purpose: a person clicking through the site as
     * fast as they can read manages a page every few seconds, so they never meet it. People
     * sharing one address -- an office, a household, a carrier's NAT -- are one visitor here by
     * the ADR's choice and share one budget, which 60 also covers for several at once. Meeting it
     * costs only an uncounted event, since the site ignores every failure. Against abuse it bounds
     * the work per address rather than the table, which the dedup index bounds already: one
     * address can make at most one row per page, project, link and day however fast it sends.
     */
    static final int MAX_EVENTS_PER_WINDOW = 60;
    static final Duration RATE_LIMIT_WINDOW = Duration.ofMinutes(1);

    /**
     * Namespaces this module's keys in the shared limiter (CLAUDE.md's shared-components item).
     * Both event endpoints share one budget per visitor, and every key under this prefix is passed
     * the same {@link #RATE_LIMIT_WINDOW}, per the limiter's one-window-per-key contract.
     */
    static final String RATE_LIMIT_KEY_PREFIX = "analytics:";

    static final String DO_NOT_TRACK_HEADER = "DNT";
    static final String GLOBAL_PRIVACY_CONTROL_HEADER = "Sec-GPC";

    /**
     * A user agent that calls itself a bot, a crawler, a spider or a headless browser (the ADR's
     * decision 6). The one place the list lives. Substring and case-insensitive, so
     * {@code Googlebot}, {@code bingbot}, {@code AhrefsBot}, {@code Baiduspider},
     * {@code Yahoo! Slurp}, {@code HeadlessChrome}, {@code Chrome-Lighthouse} and
     * {@code PhantomJS} all match.
     *
     * <p>Self-declared only: this catches automation that says what it is, not automation that
     * pretends to be a browser, and is not meant to. One known false positive is accepted rather
     * than special-cased: Cubot phones put {@code CUBOT} in their user agent and are not counted.
     * Note that a headless browser running an end-to-end suite announces itself as
     * {@code HeadlessChrome} and is dropped too, unless the suite sets a user agent.
     */
    static final Pattern SELF_DECLARED_AUTOMATION =
        Pattern.compile("bot|crawl|spider|slurp|headless|lighthouse|phantomjs", Pattern.CASE_INSENSITIVE);

    private final DailyVisitorHasher visitorHasher;
    private final ClientIpResolver clientIpResolver;
    private final InMemoryRateLimiter rateLimiter;
    private final ProjectService projectService;
    private final AnalyticsEventStore store;

    AnalyticsService(
        DailyVisitorHasher visitorHasher,
        ClientIpResolver clientIpResolver,
        InMemoryRateLimiter rateLimiter,
        ProjectService projectService,
        AnalyticsEventStore store
    ) {
        this.visitorHasher = visitorHasher;
        this.clientIpResolver = clientIpResolver;
        this.rateLimiter = rateLimiter;
        this.projectService = projectService;
        this.store = store;
    }

    void recordPageView(PageViewRequest event, HttpServletRequest request) {
        AnalyticsPage page = event.analyticsPage();
        UUID projectId = event.projectId();
        record(request,
            () -> page != AnalyticsPage.PROJECT || projectService.isPublishedProject(projectId),
            AnalyticsEventType.PAGE_VIEW, page, projectId, null);
    }

    void recordLinkClick(LinkClickRequest event, HttpServletRequest request) {
        // A link click's page is always a project's page (ck_analytics_event_link_click_page).
        record(request,
            () -> projectService.isPublishedProjectLink(event.projectId(), event.url()),
            AnalyticsEventType.LINK_CLICK, AnalyticsPage.PROJECT, event.projectId(), event.url());
    }

    private void record(HttpServletRequest request, BooleanSupplier namesSomethingPublic,
                        AnalyticsEventType type, AnalyticsPage page, UUID projectId, String linkUrl) {
        // 1. The request alone.
        if (askedNotToBeTracked(request) || isAuthenticated() || isSelfDeclaredAutomation(request)) {
            return;
        }

        // 2. The visitor, and the day: read once, here, and used for both the salt and
        //    occurred_on. Never logged, at any level -- neither the address nor the hash.
        Optional<VisitorDay> visitor = visitorHasher.identify(clientIpResolver.resolve(request));
        if (visitor.isEmpty()) {
            return;
        }
        String visitorHash = visitor.get().visitorHash();

        // 3. The rate limit. The message names no visitor.
        if (!rateLimiter.tryAcquire(RATE_LIMIT_KEY_PREFIX + visitorHash, MAX_EVENTS_PER_WINDOW, RATE_LIMIT_WINDOW)) {
            throw new RateLimitExceededException("Too many analytics events");
        }

        // 4. What the event names.
        if (!namesSomethingPublic.getAsBoolean()) {
            return;
        }

        // 5. At most one row; a duplicate is the same 204.
        store.insertIfAbsent(type, page, projectId, linkUrl, visitorHash, visitor.get().day());
    }

    /**
     * {@code DNT: 1} or {@code Sec-GPC: 1}. Only the value {@code 1} opts out, as both
     * specifications define it; {@code DNT: 0} is a visitor saying they consent.
     */
    private static boolean askedNotToBeTracked(HttpServletRequest request) {
        return isOne(request.getHeader(DO_NOT_TRACK_HEADER)) || isOne(request.getHeader(GLOBAL_PRIVACY_CONTROL_HEADER));
    }

    private static boolean isOne(String headerValue) {
        return headerValue != null && headerValue.trim().equals("1");
    }

    /**
     * The admin's own visits are not counted. The filter chain has already checked any bearer
     * token by the time this runs -- a refused one is a 401 before the controller is reached -- so
     * a non-anonymous authentication here means a valid token. Any such authentication is dropped,
     * not only one with the ADMIN role: the admin is the only principal this application issues
     * tokens to, and dropping more is the safe direction for a count.
     */
    private static boolean isAuthenticated() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        return authentication != null
            && authentication.isAuthenticated()
            && !(authentication instanceof AnonymousAuthenticationToken);
    }

    /** Missing, blank, or self-declared automation; see {@link #SELF_DECLARED_AUTOMATION}. */
    static boolean isSelfDeclaredAutomation(String userAgent) {
        return userAgent == null || userAgent.isBlank() || SELF_DECLARED_AUTOMATION.matcher(userAgent).find();
    }

    private static boolean isSelfDeclaredAutomation(HttpServletRequest request) {
        return isSelfDeclaredAutomation(request.getHeader("User-Agent"));
    }
}
