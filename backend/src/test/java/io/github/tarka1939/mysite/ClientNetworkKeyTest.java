package io.github.tarka1939.mysite;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import org.junit.jupiter.api.Test;

import jakarta.servlet.http.HttpServletRequest;

/**
 * {@link ClientIpResolver#networkOf} and {@link ClientIpResolver#resolveNetwork}: the key every
 * per-client rate limit and the analytics visitor count use (#314).
 *
 * <p>IPv6 addresses are from the documentation prefix {@code 2001:db8::/32}, IPv4 ones from
 * TEST-NET-1 and TEST-NET-3, and 198.51.100.x (TEST-NET-2) stands in for the proxy, as in
 * {@link ClientIpResolverTest}.
 */
class ClientNetworkKeyTest {

    @Test
    void twoAddressesInOneSlash64_shareOneKey() {
        // What an RFC 4941 temporary address does to a visitor over a day: same network, new
        // interface identifier.
        assertThat(ClientIpResolver.networkOf("2001:db8:1:2::1"))
            .isEqualTo(ClientIpResolver.networkOf("2001:db8:1:2:aaaa:bbbb:cccc:dddd"));
    }

    @Test
    void twoSlash64s_getTwoKeys() {
        assertThat(ClientIpResolver.networkOf("2001:db8:1:2::1"))
            .isNotEqualTo(ClientIpResolver.networkOf("2001:db8:1:3::1"));
    }

    @Test
    void theKeyIsTheSlash64WrittenOut() {
        assertThat(ClientIpResolver.networkOf("2001:db8:1:2:aaaa::1"))
            .isEqualTo("2001:db8:1:2:0:0:0:0/64");
    }

    @Test
    void spellingsOfOneAddress_shareOneKey() {
        // The compressed form a header might carry, the zero-padded one, and the uncompressed form
        // a servlet container reports for its peer.
        String key = ClientIpResolver.networkOf("2001:db8::1");

        assertThat(ClientIpResolver.networkOf("2001:0db8:0000:0000:0000:0000:0000:0001"))
            .isEqualTo(key);
        assertThat(ClientIpResolver.networkOf("2001:db8:0:0:0:0:0:1")).isEqualTo(key);
    }

    @Test
    void anIpv4MappedAddress_isTheIpv4ClientItCarries() {
        assertThat(ClientIpResolver.networkOf("::ffff:192.0.2.1")).isEqualTo("192.0.2.1");
        // Not the ::/64 that every mapped address shares, or all IPv4 clients arriving this way
        // would be one client.
        assertThat(ClientIpResolver.networkOf("::ffff:192.0.2.1"))
            .isNotEqualTo(ClientIpResolver.networkOf("::ffff:192.0.2.2"));
    }

    @Test
    void ipv4_isUnchanged() {
        assertThat(ClientIpResolver.networkOf("203.0.113.9")).isEqualTo("203.0.113.9");
        assertThat(ClientIpResolver.networkOf("203.0.113.9"))
            .isNotEqualTo(ClientIpResolver.networkOf("203.0.113.10"));
    }

    @Test
    void somethingThatIsNotAnAddress_keysOnItself() {
        assertThat(ClientIpResolver.networkOf("unknown")).isEqualTo("unknown");
        assertThat(ClientIpResolver.networkOf(null)).isNull();
    }

    @Test
    void resolveNetwork_reducesTheTcpPeer() {
        ClientIpResolver resolver = new ClientIpResolver("", "", 0);

        assertThat(resolver.resolveNetwork(request("2001:db8:1:2:0:0:0:5", null)))
            .isEqualTo("2001:db8:1:2:0:0:0:0/64");
    }

    @Test
    void resolveNetwork_reducesAForwardedVisitor() {
        // The deployed path: the address arrives in a header from a trusted proxy, and is reduced
        // after the trust decision, not instead of it.
        ClientIpResolver resolver = new ClientIpResolver("198.51.100.0/24", "CF-Connecting-IP", 0);

        assertThat(resolver.resolveNetwork(request("198.51.100.7", "2001:db8:9:9::42")))
            .isEqualTo("2001:db8:9:9:0:0:0:0/64");
    }

    @Test
    void resolveNetwork_fromAnUntrustedPeer_stillIgnoresTheHeader() {
        // Reducing to the /64 must not loosen #168's boundary: the claimed visitor is not believed,
        // and the peer is the key.
        ClientIpResolver resolver = new ClientIpResolver("198.51.100.0/24", "CF-Connecting-IP", 0);

        assertThat(resolver.resolveNetwork(request("2001:db8:5:5::1", "2001:db8:9:9::42")))
            .isEqualTo("2001:db8:5:5:0:0:0:0/64");
    }

    private static HttpServletRequest request(String remoteAddr, String cfConnectingIp) {
        HttpServletRequest request = mock(HttpServletRequest.class);
        when(request.getRemoteAddr()).thenReturn(remoteAddr);
        when(request.getHeader("CF-Connecting-IP")).thenReturn(cfConnectingIp);
        return request;
    }
}
