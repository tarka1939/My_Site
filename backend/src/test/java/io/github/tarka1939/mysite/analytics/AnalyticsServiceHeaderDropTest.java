package io.github.tarka1939.mysite.analytics;

import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;

import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;

import io.github.tarka1939.mysite.ClientIpResolver;
import io.github.tarka1939.mysite.InMemoryRateLimiter;
import io.github.tarka1939.mysite.project.ProjectService;

/**
 * The ordering in {@link AnalyticsService}'s step 1: a request dropped on its headers alone is
 * dropped before its address is resolved or hashed, so no collaborator is touched at all. The
 * integration tests see only the 204 and the empty table, which are the same whether the address
 * was hashed first and then discarded or never hashed; only a mock can tell those apart.
 */
@ExtendWith(MockitoExtension.class)
class AnalyticsServiceHeaderDropTest {

    private static final String BROWSER =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0";

    private static final UUID PROJECT = UUID.fromString("00000000-0000-0000-0000-000000000001");

    @Mock
    private DailyVisitorHasher visitorHasher;
    @Mock
    private ClientIpResolver clientIpResolver;
    @Mock
    private InMemoryRateLimiter rateLimiter;
    @Mock
    private ProjectService projectService;
    @Mock
    private AnalyticsEventStore store;

    private AnalyticsService service;

    @BeforeEach
    void setUp() {
        service = new AnalyticsService(
            visitorHasher, clientIpResolver, rateLimiter, projectService, store);
    }

    @AfterEach
    void clearSecurityContext() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void doNotTrack_isDroppedBeforeTheAddressIsResolved() {
        assertDroppedWithoutTouchingAnyCollaborator(withHeader(request(BROWSER), "DNT", "1"));
    }

    @Test
    void globalPrivacyControl_isDroppedBeforeTheAddressIsResolved() {
        assertDroppedWithoutTouchingAnyCollaborator(withHeader(request(BROWSER), "Sec-GPC", "1"));
    }

    @Test
    void theAuthenticatedAdmin_isDroppedBeforeTheAddressIsResolved() {
        SecurityContextHolder.getContext().setAuthentication(
            new UsernamePasswordAuthenticationToken(
                "admin", null, List.of(new SimpleGrantedAuthority("ROLE_ADMIN"))));

        assertDroppedWithoutTouchingAnyCollaborator(request(BROWSER));
    }

    @Test
    void aMissingUserAgent_isDroppedBeforeTheAddressIsResolved() {
        assertDroppedWithoutTouchingAnyCollaborator(request(null));
    }

    @Test
    void aBlankUserAgent_isDroppedBeforeTheAddressIsResolved() {
        assertDroppedWithoutTouchingAnyCollaborator(request("   "));
    }

    @Test
    void aSelfDeclaredBot_isDroppedBeforeTheAddressIsResolved() {
        assertDroppedWithoutTouchingAnyCollaborator(
            request("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"));
    }

    /**
     * The control for the six above: the same service and mocks, with a request that has none of
     * their reasons, does reach the resolver and the hasher. Without it a wiring mistake that made
     * every call a no-op would pass them all.
     */
    @Test
    void anOrdinaryVisitor_reachesTheResolverAndTheHasher() {
        MockHttpServletRequest request = request(BROWSER);

        service.recordPageView(new PageViewRequest("about", null), request);

        verify(clientIpResolver).resolve(request);
        verify(visitorHasher).identify(null);
    }

    /** Both entry points, since each hands its own check to the same {@code record}. */
    private void assertDroppedWithoutTouchingAnyCollaborator(MockHttpServletRequest request) {
        service.recordPageView(new PageViewRequest("project", PROJECT), request);
        verifyNoCollaboratorTouched();

        service.recordLinkClick(
            new LinkClickRequest(PROJECT, "https://example.invalid/repo"), request);
        verifyNoCollaboratorTouched();
    }

    private void verifyNoCollaboratorTouched() {
        verifyNoInteractions(visitorHasher, clientIpResolver, rateLimiter, projectService, store);
    }

    private static MockHttpServletRequest request(String userAgent) {
        MockHttpServletRequest request = new MockHttpServletRequest();
        if (userAgent != null) {
            request.addHeader("User-Agent", userAgent);
        }
        return request;
    }

    private static MockHttpServletRequest withHeader(
        MockHttpServletRequest request, String name, String value
    ) {
        request.addHeader(name, value);
        return request;
    }
}
