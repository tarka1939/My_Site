package io.github.tarka1939.mysite;

import java.io.IOException;
import java.nio.charset.StandardCharsets;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.firewall.RequestRejectedException;
import org.springframework.security.web.firewall.RequestRejectedHandler;
import org.springframework.security.web.header.HeaderWriterFilter;

import jakarta.servlet.Filter;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

/**
 * Answers a request the firewall refuses -- a path with {@code ;}, an encoded {@code ..}, a
 * {@code //} -- with a 400 and the same security headers as every other API response (#243).
 *
 * <p>{@code StrictHttpFirewall} refuses such a request before any filter chain runs, so the
 * chain's {@link HeaderWriterFilter} never sees it. Spring Security's default answer,
 * {@code HttpStatusRequestRejectedHandler}, calls {@code sendError(400)}, and that makes it worse
 * rather than better: the container renders the error on an ERROR dispatch to {@code /error},
 * which HeaderWriterFilter skips, and which the authorization rules do not permit -- so the 400
 * became a bare 401 with no security headers. That is what production answered.
 *
 * <p>So this writes the response itself, never through {@code sendError}, and takes its headers
 * from the API chain's own HeaderWriterFilter rather than from a second list of them: a header
 * added in {@link SecurityConfig} reaches a rejected request with no change here.
 */
final class SecurityHeadersRequestRejectedHandler implements RequestRejectedHandler {

    private static final Logger log = LoggerFactory.getLogger(SecurityHeadersRequestRejectedHandler.class);

    /**
     * Fixed, so nothing from the rejected request is echoed back. The firewall's own message can
     * quote the offending header value, which is why it goes to the log and not here.
     */
    static final String BODY = "{\"type\":\"about:blank\",\"title\":\"Bad Request\",\"status\":400,"
        + "\"detail\":\"The request was rejected.\"}";

    private final Filter headerWriter;

    SecurityHeadersRequestRejectedHandler(SecurityFilterChain chain) {
        // Found at startup, so a chain without one fails the boot rather than the first rejection.
        this.headerWriter = chain.getFilters().stream()
            .filter(HeaderWriterFilter.class::isInstance)
            .findFirst()
            .orElseThrow(() -> new IllegalStateException(
                "the security filter chain has no HeaderWriterFilter to take rejected requests' headers from"));
    }

    @Override
    public void handle(HttpServletRequest request, HttpServletResponse response, RequestRejectedException ex)
            throws IOException, ServletException {
        // DEBUG for two reasons. Scanners probe for path traversal all day, and none of it is
        // anything to act on. And the message can quote the offending header's value, an
        // Authorization header's included -- which is why it goes here and never into the body.
        // This package logs at INFO in prod (application-prod.yml), so the line is never written
        // there; dev turns it on, where the token in it is one the local backend issued, and why
        // a request was refused is exactly what someone debugging it wants to know.
        log.debug("Rejecting request: {}", ex.getMessage());
        if (response.isCommitted()) {
            // Too late to answer: a status and headers have already gone out.
            return;
        }
        // Drop anything written before the rejection, as sendError would have.
        response.resetBuffer();
        // Run with nothing after it, the filter only writes its headers onto the response.
        headerWriter.doFilter(request, response, (req, res) -> { });
        response.setStatus(HttpServletResponse.SC_BAD_REQUEST);
        response.setContentType(MediaType.APPLICATION_PROBLEM_JSON_VALUE);
        response.setCharacterEncoding(StandardCharsets.UTF_8);
        response.getWriter().write(BODY);
    }
}
