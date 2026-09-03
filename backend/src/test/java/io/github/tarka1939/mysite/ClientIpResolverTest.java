package io.github.tarka1939.mysite;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.util.Collections;
import java.util.List;

import org.junit.jupiter.api.Test;
import org.springframework.security.web.util.matcher.IpAddressMatcher;

import jakarta.servlet.http.HttpServletRequest;

/**
 * The trust boundary for issue #168, tested at the unit level because every interesting case is
 * about a header the application must refuse to believe.
 *
 * <p>Addresses are drawn from the documentation ranges: 198.51.100.x (TEST-NET-2) stands in for
 * the proxy, 203.0.113.x (TEST-NET-3) for visitors, 192.0.2.x (TEST-NET-1) for the Cloudflare
 * edge.
 */
class ClientIpResolverTest {

    private static final String PROXY_CIDR = "198.51.100.0/24";
    private static final String PROXY_ADDRESS = "198.51.100.7";
    private static final String CF_HEADER = "CF-Connecting-IP";

    @Test
    void withNoConfiguration_ignoresForwardedHeadersEntirely() {
        // The pre-#168 behaviour, and the one every environment that has not declared a proxy
        // must keep: an unconfigured app is reachable directly, so any header on the request was
        // put there by whoever it is about to rate-limit.
        ClientIpResolver resolver = new ClientIpResolver("", "", 0);

        String resolved = resolver.resolve(request("203.0.113.1", "203.0.113.200", "203.0.113.201"));

        assertThat(resolved).isEqualTo("203.0.113.1");
    }

    @Test
    void fromUntrustedPeer_ignoresForwardedHeadersAndUsesThePeerAddress() {
        // A trusted-proxy list exists, but this request did not come from one -- someone
        // addressing the container directly, or reaching it after the firewall rule is changed.
        // Both headers must count for nothing.
        ClientIpResolver resolver = new ClientIpResolver(PROXY_CIDR, CF_HEADER, 2);

        String resolved = resolver.resolve(request("203.0.113.66", "203.0.113.200", "203.0.113.201, 203.0.113.202"));

        assertThat(resolved)
            .as("a request that did not arrive from a trusted proxy speaks only for itself")
            .isEqualTo("203.0.113.66");
    }

    @Test
    void fromTrustedProxy_usesTheConfiguredClientIpHeader() {
        ClientIpResolver resolver = new ClientIpResolver(PROXY_CIDR, CF_HEADER, 2);

        String resolved = resolver.resolve(request(PROXY_ADDRESS, "203.0.113.42", null));

        assertThat(resolved).isEqualTo("203.0.113.42");
    }

    @Test
    void fromTrustedProxy_prefersTheClientIpHeaderOverForwardedFor() {
        // CF-Connecting-IP is set by the OUTERMOST proxy and overwritten there, so it is
        // single-valued and needs no position arithmetic; X-Forwarded-For is the fallback.
        ClientIpResolver resolver = new ClientIpResolver(PROXY_CIDR, CF_HEADER, 2);

        String resolved = resolver.resolve(
            request(PROXY_ADDRESS, "203.0.113.42", "203.0.113.99, 203.0.113.7, 192.0.2.10"));

        assertThat(resolved).isEqualTo("203.0.113.42");
    }

    @Test
    void multiEntryForwardedFor_resolvesToTheEntryCountedFromTheRightNotEitherEnd() {
        // The header as the deployed two-proxy chain produces it:
        //
        //   203.0.113.99  -- invented by the visitor and sent with the request. Cloudflare
        //                    APPENDS rather than replaces, so a forged value survives here, on
        //                    the LEFT. Taking entries[0] would hand rate-limit evasion to anyone
        //                    willing to send a different value each time.
        //   203.0.113.7   -- the visitor, as Cloudflare saw it. The one true answer.
        //   192.0.2.10    -- the Cloudflare edge node, as the Mikrus nginx saw it when it
        //                    appended its own peer. Taking entries[length - 1] would bucket the
        //                    whole internet into a handful of edge addresses -- nearly the bug
        //                    being fixed.
        //
        // With two trusted proxies in front, each appending the peer it saw, the visitor is the
        // 2nd entry FROM THE RIGHT. Counting from the right is what makes it unforgeable: a
        // caller can only prepend, and prepending does not move the right-hand end.
        ClientIpResolver resolver = new ClientIpResolver(PROXY_CIDR, "", 2);

        String resolved = resolver.resolve(
            request(PROXY_ADDRESS, null, "203.0.113.99, 203.0.113.7, 192.0.2.10"));

        assertThat(resolved).isEqualTo("203.0.113.7");
        assertThat(resolved).as("never the leftmost entry -- the caller controls it").isNotEqualTo("203.0.113.99");
        assertThat(resolved).as("never the rightmost entry -- that is the outer proxy").isNotEqualTo("192.0.2.10");
    }

    @Test
    void forwardedFor_withNoForgedPrefix_stillResolvesToTheVisitor() {
        // The ordinary case: the visitor sent no X-Forwarded-For, so the list is exactly the two
        // entries the two proxies appended. Same arithmetic, index 0 this time.
        ClientIpResolver resolver = new ClientIpResolver(PROXY_CIDR, "", 2);

        String resolved = resolver.resolve(request(PROXY_ADDRESS, null, "203.0.113.7, 192.0.2.10"));

        assertThat(resolved).isEqualTo("203.0.113.7");
    }

    @Test
    void forwardedFor_shorterThanTheHopCount_fallsBackToThePeerAddress() {
        // A proxy that overwrites instead of appending, or a hop that was removed. There is no
        // entry that can be the client, so degrade rather than take whatever is nearest.
        ClientIpResolver resolver = new ClientIpResolver(PROXY_CIDR, "", 2);

        String resolved = resolver.resolve(request(PROXY_ADDRESS, null, "192.0.2.10"));

        assertThat(resolved).isEqualTo(PROXY_ADDRESS);
    }

    @Test
    void forwardedValuesThatAreNotAddressLiterals_fallBackToThePeerAddress() {
        ClientIpResolver resolver = new ClientIpResolver(PROXY_CIDR, CF_HEADER, 2);

        assertThat(resolver.resolve(request(PROXY_ADDRESS, "not-an-address", null))).isEqualTo(PROXY_ADDRESS);
        assertThat(resolver.resolve(request(PROXY_ADDRESS, "   ", null))).isEqualTo(PROXY_ADDRESS);
        assertThat(resolver.resolve(request(PROXY_ADDRESS, null, "a, b, c"))).isEqualTo(PROXY_ADDRESS);
        // A hostname must not be resolved: InetAddress.ofLiteral rejects it outright rather than
        // performing the DNS lookup getByName would.
        assertThat(resolver.resolve(request(PROXY_ADDRESS, "localhost", null))).isEqualTo(PROXY_ADDRESS);
    }

    @Test
    void forwardedAddressIsCanonicalised_soOneAddressIsNotTwoBuckets() {
        ClientIpResolver resolver = new ClientIpResolver(PROXY_CIDR, CF_HEADER, 0);

        String compressed = resolver.resolve(request(PROXY_ADDRESS, "2001:db8::1", null));
        String expanded = resolver.resolve(request(PROXY_ADDRESS, "2001:0db8:0000:0000:0000:0000:0000:0001", null));

        // Pinned to the canonical form on BOTH sides, not merely asserted equal to each other.
        // Equality alone also holds when the resolver ignores the header entirely and returns
        // PROXY_ADDRESS for both -- in which case a test named "so one address is not two buckets"
        // passes having verified nothing whatsoever about buckets. Cold review of PR #172 found
        // this; it is the third instance tonight of an assertion measuring something adjacent to
        // what it names.
        assertThat(compressed).isEqualTo("2001:db8:0:0:0:0:0:1");
        assertThat(expanded).isEqualTo("2001:db8:0:0:0:0:0:1");
    }

    @Test
    void repeatedForwardedForHeaderLines_areJoinedRatherThanTruncatedToTheFirst() {
        // RFC 7230 makes repeated lines of a list-valued header equivalent to one comma-separated
        // line, and a proxy may append a line instead of extending one. Reading only the first
        // line would shorten the list, and because the client is indexed from the RIGHT, a shorter
        // list silently shifts which entry is read -- here it would yield 203.0.113.99, the entry
        // the caller supplied.
        ClientIpResolver resolver = new ClientIpResolver(PROXY_CIDR, "", 2);

        String resolved = resolver.resolve(
            requestWithForwardedForLines(
                PROXY_ADDRESS, null, List.of("203.0.113.99", "203.0.113.7, 192.0.2.10")));

        assertThat(resolved).isEqualTo("203.0.113.7");
    }

    @Test
    void trustedProxyMatchingHonoursThePrefixLength() {
        ClientIpResolver resolver = new ClientIpResolver("198.51.100.0/24", CF_HEADER, 0);

        assertThat(resolver.resolve(request("198.51.100.254", "203.0.113.42", null))).isEqualTo("203.0.113.42");
        assertThat(resolver.resolve(request("198.51.101.1", "203.0.113.42", null))).isEqualTo("198.51.101.1");
    }

    @Test
    void ipv6TrustedProxyBlockIsMatched() {
        // The shape production actually runs: the app is reached over public IPv6 and the Mikrus
        // proxy nodes sit in /64s.
        ClientIpResolver resolver = new ClientIpResolver("2a01:4f8:c012:8ba::/64", CF_HEADER, 0);

        assertThat(resolver.resolve(request("2a01:4f8:c012:8ba::1", "203.0.113.42", null)))
            .isEqualTo("203.0.113.42");
        assertThat(resolver.resolve(request("2a01:4f8:c012:8bb::1", "203.0.113.42", null)))
            .isEqualTo("2a01:4f8:c012:8bb::1");
    }

    @Test
    void theValuesApplicationProdYmlDefaultsTo_areValidConfiguration() {
        // Copied literally from application-prod.yml, so this does not track edits to that file --
        // it does something narrower and still worth having: it proves these particular strings
        // construct, which is the difference between a CIDR typo showing up here and showing up as
        // a refusal to boot on the VPS.
        ClientIpResolver resolver = new ClientIpResolver(
            "2a01:4f8:c012:8ba::/64,2a01:4f9:c012:f2aa::/64", "CF-Connecting-IP", 2);

        assertThat(resolver.resolve(request("2a01:4f9:c012:f2aa::1", "203.0.113.7", null)))
            .as("a Mikrus proxy node may speak for a visitor")
            .isEqualTo("203.0.113.7");
        assertThat(resolver.resolve(request("2a01:4f9:3051:4119::159", "203.0.113.7", null)))
            .as("the container's own public address is not one of the proxies")
            .isEqualTo("2a01:4f9:3051:4119::159");
    }

    @Test
    void malformedTrustedProxyEntry_failsFastAtConstruction() {
        // Present but wrong, so it must not boot: a typo'd CIDR would otherwise mean the proxy is
        // never trusted and both limiters stay silently collapsed onto one bucket.
        assertThatThrownBy(() -> new ClientIpResolver("198.51.100.0/24, not-an-address", CF_HEADER, 0))
            .isInstanceOf(IllegalStateException.class)
            .hasMessageContaining("not-an-address");
        assertThatThrownBy(() -> new ClientIpResolver("198.51.100.0/33", CF_HEADER, 0))
            .isInstanceOf(IllegalStateException.class)
            .hasMessageContaining("198.51.100.0/33");
        assertThatThrownBy(() -> new ClientIpResolver("198.51.100.0/x", CF_HEADER, 0))
            .isInstanceOf(IllegalStateException.class)
            .hasMessageContaining("prefix length");
    }

    @Test
    void aSlashZeroTrustedProxyBlock_failsFastAtConstruction() {
        // "/0" is "*" in another notation: it would make every caller a trusted proxy, so a forged
        // header would become a total and silent bypass of per-IP rate limiting -- reachable from
        // one env-var typo, with no startup complaint. SecurityConfig already refuses a wildcard
        // CORS origin for the same reason; this closes the asymmetry.
        assertThatThrownBy(() -> new ClientIpResolver("0.0.0.0/0", CF_HEADER, 0))
            .isInstanceOf(IllegalStateException.class)
            .hasMessageContaining("never a /0 block");
        assertThatThrownBy(() -> new ClientIpResolver("::/0", CF_HEADER, 0))
            .isInstanceOf(IllegalStateException.class)
            .hasMessageContaining("never a /0 block");
        // Rejected even when hidden behind a legitimate entry.
        assertThatThrownBy(() -> new ClientIpResolver("198.51.100.0/24,0.0.0.0/0", CF_HEADER, 0))
            .isInstanceOf(IllegalStateException.class)
            .hasMessageContaining("never a /0 block");
    }

    @Test
    void anIpv4SlashZeroWouldHaveMatchedIpv6Peers_whichIsWhyItIsRejectedRatherThanTreatedAsInert() {
        // The reason the check above is not "harmless on an IPv6-only host". Spring Security's
        // IpAddressMatcher, driven directly here rather than reasoned about: 0.0.0.0/0 matches an
        // IPv6 peer, so an operator reasoning "we only speak v6, a v4 /0 cannot match anything"
        // would be wrong. If this ever stops holding, the /0 rejection is still correct and this
        // test is what says why it was written.
        assertThat(new IpAddressMatcher("0.0.0.0/0").matches("2a01:4f9:3051:4119::159")).isTrue();
    }

    @Test
    void negativeHopCount_failsFastAtConstruction() {
        // Configured so that ONLY the hop-count check can fire: a trusted proxy and a header
        // source are both present, so neither of the two "these properties contradict each other"
        // checks is in play. Mutation testing caught the first version of this, which passed
        // 198.51.100.0/24 with no header and was satisfied by a different exception whose message
        // happens to mention trusted-hop-count too.
        assertThatThrownBy(() -> new ClientIpResolver(PROXY_CIDR, CF_HEADER, -1))
            .isInstanceOf(IllegalStateException.class)
            .hasMessageContaining("must not be negative");
    }

    @Test
    void headerSourceWithoutAnyTrustedProxy_failsFastAtConstruction() {
        // Config that reads as "trust this header" while trusting nobody to have set it. Harmless
        // at runtime, which is the problem: it looks configured and does nothing.
        assertThatThrownBy(() -> new ClientIpResolver("", CF_HEADER, 0))
            .isInstanceOf(IllegalStateException.class)
            .hasMessageContaining("trusted-proxies");
        assertThatThrownBy(() -> new ClientIpResolver("", "", 2))
            .isInstanceOf(IllegalStateException.class)
            .hasMessageContaining("trusted-proxies");
    }

    @Test
    void trustedProxiesWithNoHeaderSource_failsFastAtConstruction() {
        assertThatThrownBy(() -> new ClientIpResolver(PROXY_CIDR, "", 0))
            .isInstanceOf(IllegalStateException.class)
            .hasMessageContaining("neither client-ip-header nor");
    }

    private static HttpServletRequest request(String remoteAddr, String clientIpHeader, String forwardedFor) {
        return requestWithForwardedForLines(remoteAddr, clientIpHeader,
            forwardedFor == null ? List.of() : List.of(forwardedFor));
    }

    /**
     * {@code forwardedForLines} is a list because {@code X-Forwarded-For} may legitimately arrive
     * as several header lines. Answered with a fresh {@code Enumeration} per call rather than a
     * fixed one, since an Enumeration is consumed by reading it and several tests resolve the same
     * request twice.
     */
    private static HttpServletRequest requestWithForwardedForLines(
        String remoteAddr, String clientIpHeader, List<String> forwardedForLines
    ) {
        HttpServletRequest request = mock(HttpServletRequest.class);
        when(request.getRemoteAddr()).thenReturn(remoteAddr);
        when(request.getHeader(CF_HEADER)).thenReturn(clientIpHeader);
        when(request.getHeaders(ClientIpResolver.X_FORWARDED_FOR))
            .thenAnswer(invocation -> Collections.enumeration(forwardedForLines));
        return request;
    }
}
