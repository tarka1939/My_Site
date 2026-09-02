package io.github.tarka1939.mysite;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import org.junit.jupiter.api.Test;

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

        assertThat(compressed).isEqualTo(expanded);
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
        HttpServletRequest request = mock(HttpServletRequest.class);
        when(request.getRemoteAddr()).thenReturn(remoteAddr);
        when(request.getHeader(CF_HEADER)).thenReturn(clientIpHeader);
        when(request.getHeader(ClientIpResolver.X_FORWARDED_FOR)).thenReturn(forwardedFor);
        return request;
    }
}
