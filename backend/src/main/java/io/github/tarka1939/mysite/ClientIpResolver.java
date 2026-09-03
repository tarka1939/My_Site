package io.github.tarka1939.mysite;

import java.net.InetAddress;
import java.util.ArrayList;
import java.util.Enumeration;
import java.util.List;
import java.util.StringJoiner;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.web.util.matcher.IpAddressMatcher;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import jakarta.servlet.http.HttpServletRequest;

/**
 * Works out which address a request should be rate-limited against when the application sits
 * behind one or more reverse proxies (issue #168).
 *
 * <h2>Why this exists</h2>
 * {@code getRemoteAddr()} is the address of whatever opened the TCP connection. Direct from the
 * internet that is the visitor; behind a proxy it is the <em>proxy</em>, identically for every
 * request on the internet, which collapses all three per-IP limiters -- {@code AuthService}'s 5
 * logins/15min, {@code ContactService}'s 5 messages/hour, and
 * {@code PasswordResetService.requestReset}'s 5 requests/hour -- into a single global bucket. Any
 * stranger could then lock the owner out of the admin panel, silence the contact form, or block
 * the password-reset path that is the way back in from the first.
 *
 * <h2>Why it is conditional, and fails to {@code getRemoteAddr()}</h2>
 * Forwarded headers are caller-controlled: anyone can put {@code X-Forwarded-For: 1.2.3.4} on a
 * request. Trusting one unconditionally is <em>worse</em> than the collapsed bucket, because a
 * forged header with a fresh value per request defeats rate limiting entirely rather than merely
 * globalising it. So a forwarded header is read only when the request's immediate peer -- the
 * address that actually opened the connection, which no caller can forge -- matches a configured
 * trusted proxy. Every other path, including "no configuration at all", returns
 * {@code getRemoteAddr()}, i.e. exactly the pre-#168 behaviour. That is the fail-safe direction
 * per CLAUDE.md's "fails closed, never open".
 *
 * <h2>Where the truth lives in a two-proxy chain</h2>
 * The deployed shape is {@code visitor -> Cloudflare -> Mikrus nginx -> app}, so
 * {@code X-Forwarded-For} arrives with more than one entry and neither end of it is the visitor:
 * <ul>
 *   <li>Cloudflare <em>appends</em> the address it saw to any inbound {@code X-Forwarded-For},
 *       so a value the visitor invented survives to the <strong>left</strong> of the real one.
 *       The first (leftmost) entry is therefore attacker-controlled and must never be used --
 *       this is the classic "take the first element" mistake.</li>
 *   <li>The Mikrus nginx then appends <em>its</em> peer, the Cloudflare edge node. The last
 *       (rightmost) entry is therefore a Cloudflare address, not a visitor: keying on it would
 *       bucket the whole internet into the handful of edge nodes serving this site -- nearly as
 *       bad as the bug being fixed.</li>
 * </ul>
 * With {@code N} trusted proxies in front, each appending the peer it saw, the visitor is the
 * {@code N}th entry counted <strong>from the right</strong>: {@code [forged..., visitor,
 * cf-edge]} with {@code N=2} resolves to {@code visitor}. Counting from the right is what makes
 * it unforgeable -- a caller can only prepend entries, and prepending shifts nothing at the
 * right-hand end. Counting from the left is forgeable by construction. If the list is shorter
 * than {@code N} (a proxy that overwrites instead of appending, or a hop removed), the index
 * falls off the front and this degrades to {@code getRemoteAddr()} rather than guessing.
 *
 * <p>The "rightmost entry that is not itself a known proxy" rule used by Tomcat's
 * {@code RemoteIpValve} is not usable here: it would need every Cloudflare edge address in the
 * trusted set, and that list is large, changes, and is not something this application can keep
 * current. A hop count expresses the same fact -- how many proxies are in front -- with a number
 * the operator knows.
 *
 * <h2>The {@code client-ip-header} property</h2>
 * Cloudflare also sets {@code CF-Connecting-IP}, overwriting any client-supplied value, to the
 * single address it saw. Where that header is configured it is preferred over
 * {@code X-Forwarded-For}: it is set by the <em>outermost</em> proxy, is single-valued, and so
 * needs no position arithmetic -- it survives an inner proxy that overwrites
 * {@code X-Forwarded-For} instead of appending, which is the one case the hop count cannot
 * recover from. The header name is configurable rather than a hardcoded {@code CF-Connecting-IP}
 * so that dropping or changing CDN is a config change. It is subject to the same trusted-peer
 * gate: off the proxy path it is exactly as forgeable as anything else.
 *
 * <h2>What this does not defend against, and how this class makes it worse</h2>
 * A caller who reaches the app <em>through</em> a trusted proxy while bypassing Cloudflare -- by
 * addressing the Mikrus node directly with the right {@code Host}, and the origin hostname is
 * published in this repository -- can forge either header, and no configuration here changes that.
 * Both mechanisms are equally exposed to it, which is why offering the second one costs nothing.
 *
 * <p><strong>Say the consequence plainly, because this class changes its direction.</strong>
 * Before, such a caller shared the one global bucket with everybody else and was still capped at 5
 * login attempts per 15 minutes. After, a fresh {@code CF-Connecting-IP} per request yields a
 * fresh bucket per request, so the cap on password guessing against the single admin account
 * becomes <em>unlimited</em>. That is a real regression for that one attack path, accepted because
 * the alternative -- keeping the collapsed bucket -- hands any stranger on the internet a
 * five-request lockout of the owner, and because the bypass has an operational fix while the
 * collapsed bucket does not. Closing it is an ingress concern (accept only Cloudflare's ranges at
 * the edge); the ufw rule restricting port 8080 to the Mikrus {@code /64}s does <em>not</em> close
 * it, since a bypassing request still arrives from a Mikrus node. Recorded rather than hidden.
 *
 * <p>A second honest limit, not introduced here and not fixable here: an IPv6 visitor holds a
 * {@code /64} or larger, so rotating the low bits gives unlimited buckets with no forgery at all.
 * "Login is rate-limited at 5 per 15 minutes" has therefore never been true for IPv6 clients, on
 * this design or the one before it. Limiting by prefix rather than by address is the fix, and it
 * is deliberately out of scope for #168.
 *
 * <h2>Why not {@code server.forward-headers-strategy}</h2>
 * Spring Boot's {@code NATIVE}/{@code FRAMEWORK} strategies rewrite {@code getRemoteAddr()} for
 * every request, and with it the scheme and host used to build URLs -- a much wider blast radius
 * than the two rate limiters that actually need this. They also cannot express either rule above:
 * {@code RemoteIpValve}'s {@code internalProxies} is a regex over the entries it walks from the
 * right, so it stops at the Cloudflare edge address, and it has no notion of
 * {@code CF-Connecting-IP}. The strategy is deliberately left at its default ({@code NONE}); do
 * not enable it alongside this class, or the peer check below starts comparing against an
 * already-rewritten address and stops meaning what it says.
 */
@Component
public class ClientIpResolver {

    static final String X_FORWARDED_FOR = "X-Forwarded-For";

    private final List<IpAddressMatcher> trustedProxies;
    private final String clientIpHeader;
    private final int trustedHopCount;

    public ClientIpResolver(
        @Value("${app.forwarded-headers.trusted-proxies:}") String trustedProxies,
        @Value("${app.forwarded-headers.client-ip-header:}") String clientIpHeader,
        @Value("${app.forwarded-headers.trusted-hop-count:0}") int trustedHopCount
    ) {
        List<String> cidrs = splitToList(trustedProxies);
        this.clientIpHeader = StringUtils.hasText(clientIpHeader) ? clientIpHeader.trim() : null;
        this.trustedHopCount = trustedHopCount;

        // Fail fast on config that is present but WRONG; degrade only on config that is absent
        // (CLAUDE.md's config-validation rule, and the same distinction application.yml already
        // draws between app.jwt.secret and RESEND_API_KEY). All three properties unset is the
        // designed no-op: no proxy, no forwarded headers, getRemoteAddr() exactly as before.
        if (trustedHopCount < 0) {
            throw new IllegalStateException(
                "app.forwarded-headers.trusted-hop-count must not be negative; got " + trustedHopCount);
        }
        boolean hasSource = this.clientIpHeader != null || trustedHopCount > 0;
        if (hasSource && cidrs.isEmpty()) {
            throw new IllegalStateException(
                "app.forwarded-headers.client-ip-header/trusted-hop-count are set but "
                    + "app.forwarded-headers.trusted-proxies is empty: no peer would ever be trusted, so "
                    + "the forwarded headers would be silently ignored and both rate limiters would stay "
                    + "collapsed onto one bucket. Set trusted-proxies, or clear the other two.");
        }
        if (!hasSource && !cidrs.isEmpty()) {
            throw new IllegalStateException(
                "app.forwarded-headers.trusted-proxies is set but neither client-ip-header nor "
                    + "trusted-hop-count is: nothing would read a forwarded header, so the trusted-proxy "
                    + "list would have no effect. Set one of them, or clear trusted-proxies.");
        }

        List<IpAddressMatcher> matchers = new ArrayList<>(cidrs.size());
        for (String cidr : cidrs) {
            matchers.add(matcherFor(cidr));
        }
        this.trustedProxies = List.copyOf(matchers);
    }

    /**
     * The address this request should be attributed to for rate limiting: the forwarded client
     * address when the peer is a trusted proxy and a usable one was forwarded, otherwise the
     * peer's own address.
     */
    public String resolve(HttpServletRequest request) {
        String peerAddress = request.getRemoteAddr();
        if (!isTrustedProxy(peerAddress)) {
            // Includes the unconfigured case, and is the whole trust boundary: a request that did
            // not arrive from a proxy speaks only for itself, whatever headers it carries.
            return peerAddress;
        }
        if (clientIpHeader != null) {
            String forwarded = canonicalAddressOrNull(request.getHeader(clientIpHeader));
            if (forwarded != null) {
                return forwarded;
            }
        }
        if (trustedHopCount > 0) {
            String forwarded = fromForwardedFor(allForwardedForValues(request));
            if (forwarded != null) {
                return forwarded;
            }
        }
        return peerAddress;
    }

    /**
     * Every {@code X-Forwarded-For} line, joined with commas.
     *
     * <p>{@code getHeader} would return only the FIRST line, and a proxy is free to append a
     * second line rather than extend the first -- RFC 7230 makes repeated lines of a list-valued
     * header exactly equivalent to one comma-separated line. Dropping the later lines would
     * shorten the list, and because the client is indexed from the RIGHT, a shorter list silently
     * shifts which entry is read. Not exploitable on the chain as documented, where both proxies
     * extend the single line; joining is unconditionally safe and removes the question.
     */
    private static String allForwardedForValues(HttpServletRequest request) {
        Enumeration<String> lines = request.getHeaders(X_FORWARDED_FOR);
        // The servlet spec says this is an empty Enumeration, never null, when the header is
        // absent; the guard is belt and braces and keeps test doubles from having to know that.
        if (lines == null) {
            return null;
        }
        StringJoiner joined = new StringJoiner(",");
        while (lines.hasMoreElements()) {
            joined.add(lines.nextElement());
        }
        return joined.toString();
    }

    private String fromForwardedFor(String headerValue) {
        if (!StringUtils.hasText(headerValue)) {
            return null;
        }
        String[] entries = headerValue.split(",");
        // Counted from the right -- see the class javadoc. Not entries[0], which a caller can
        // prepend at will, and not entries[length - 1], which is the innermost proxy's own peer.
        int index = entries.length - trustedHopCount;
        if (index < 0) {
            // Fewer entries than there are proxies in front, so no entry can be the client. A
            // misconfigured hop count, or a proxy that overwrites rather than appends, lands here;
            // both must degrade rather than settle for some other element.
            return null;
        }
        return canonicalAddressOrNull(entries[index]);
    }

    private boolean isTrustedProxy(String peerAddress) {
        if (peerAddress == null) {
            return false;
        }
        for (IpAddressMatcher matcher : trustedProxies) {
            if (matcher.matches(peerAddress)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Parses an address literal and returns its canonical text form, or null if it is not one.
     *
     * <p>{@code InetAddress.ofLiteral} rather than {@code InetAddress.getByName}: the latter
     * falls back to a DNS lookup for anything that is not a literal, which would turn a hostile
     * header value into an outbound resolver request on the request thread.
     *
     * <p>Canonicalised so that two spellings of one IPv6 address cannot become two rate-limit
     * buckets. Deliberately applied only to forwarded values, not to {@code getRemoteAddr()}: the
     * peer address is already canonical as the container reports it, and re-encoding it would
     * change every {@code contact_message.requester_ip_hash} written before this change.
     */
    private static String canonicalAddressOrNull(String raw) {
        if (raw == null) {
            return null;
        }
        String trimmed = raw.trim();
        if (trimmed.isEmpty()) {
            return null;
        }
        try {
            return InetAddress.ofLiteral(trimmed).getHostAddress();
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    /**
     * Validates here rather than leaning on {@link IpAddressMatcher}'s constructor, so that a
     * typo'd CIDR is a boot failure naming the offending entry regardless of how strict that
     * constructor happens to be in a given Spring Security version.
     */
    private static IpAddressMatcher matcherFor(String cidr) {
        String address = cidr;
        int slash = cidr.indexOf('/');
        if (slash >= 0) {
            address = cidr.substring(0, slash);
            String prefix = cidr.substring(slash + 1);
            int prefixLength;
            try {
                prefixLength = Integer.parseInt(prefix);
            } catch (NumberFormatException e) {
                throw new IllegalStateException(
                    "app.forwarded-headers.trusted-proxies entry has a non-numeric prefix length: " + cidr, e);
            }
            int maxPrefix = address.indexOf(':') >= 0 ? 128 : 32;
            // A /0 is "*" written in another notation, and it gets the same answer SecurityConfig
            // gives a wildcard CORS origin: refused, loudly, at startup. Accepting it would make
            // every caller a trusted proxy, so a forged forwarded header would become a total and
            // silent bypass of per-IP rate limiting -- the exposure this list exists to prevent,
            // reachable from one env-var typo. Rejected separately from the range check below
            // because the range check's message ("outside 0-32") would read as though 0 were fine.
            //
            // Note an IPv4 /0 is NOT inert on this IPv6-only host: Spring Security's
            // IpAddressMatcher matches 0.0.0.0/0 against IPv6 peers too, so an operator reasoning
            // "we only speak v6, a v4 /0 can't match anything" would be wrong.
            if (prefixLength == 0) {
                throw new IllegalStateException(
                    "app.forwarded-headers.trusted-proxies must name specific proxies, never a /0 block "
                        + "that matches every address; got: " + cidr);
            }
            if (prefixLength < 0 || prefixLength > maxPrefix) {
                throw new IllegalStateException(
                    "app.forwarded-headers.trusted-proxies entry has a prefix length outside 0-" + maxPrefix
                        + ": " + cidr);
            }
        }
        if (canonicalAddressOrNull(address) == null) {
            throw new IllegalStateException(
                "app.forwarded-headers.trusted-proxies entry is not an IP address or CIDR block: " + cidr);
        }
        return new IpAddressMatcher(cidr);
    }

    private static List<String> splitToList(String commaSeparated) {
        if (!StringUtils.hasText(commaSeparated)) {
            return List.of();
        }
        List<String> values = new ArrayList<>();
        for (String part : commaSeparated.split(",")) {
            String trimmed = part.trim();
            if (!trimmed.isEmpty()) {
                values.add(trimmed);
            }
        }
        return values;
    }
}
