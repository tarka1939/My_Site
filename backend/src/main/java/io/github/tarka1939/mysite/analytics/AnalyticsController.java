package io.github.tarka1939.mysite.analytics;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;

/**
 * The two public event endpoints (#58). Only exists while analytics is enabled -- see
 * {@link ConditionalOnAnalyticsEnabled} -- so with the flag off both paths are unmapped and 404.
 *
 * <p>Permitted without a token in {@code SecurityConfig}, POST only and these two paths only.
 * Every well-formed event is answered 204, whatever {@link AnalyticsService} did with it; the
 * only other answers are a 400 for a body that fails validation and a 429 past the rate limit.
 */
@RestController
@ConditionalOnAnalyticsEnabled
@RequestMapping("/api/v1/analytics")
public class AnalyticsController {

    private final AnalyticsService analyticsService;

    AnalyticsController(AnalyticsService analyticsService) {
        this.analyticsService = analyticsService;
    }

    @PostMapping("/page-views")
    public ResponseEntity<Void> recordPageView(@Valid @RequestBody PageViewRequest event, HttpServletRequest request) {
        analyticsService.recordPageView(event, request);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/link-clicks")
    public ResponseEntity<Void> recordLinkClick(@Valid @RequestBody LinkClickRequest event, HttpServletRequest request) {
        analyticsService.recordLinkClick(event, request);
        return ResponseEntity.noContent().build();
    }
}
