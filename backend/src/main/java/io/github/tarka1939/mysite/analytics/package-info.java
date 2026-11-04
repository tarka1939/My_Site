/**
 * Phase 7c analytics (#72): public page views and project link clicks, counted at most once per
 * visitor, page and UTC day, under a salt that never leaves memory. The design is docs/DECISIONS.md's
 * 2026-10-18 analytics ADR; the table is docs/DATA_MODEL.md's AnalyticsEvent; the endpoints are
 * docs/openapi.yaml's {@code /analytics/page-views}, {@code /analytics/link-clicks} and
 * {@code /admin/analytics}.
 *
 * <p>Depends on the project module's public API ({@code ProjectService}) and on the root package's
 * shared pieces ({@code ClientIpResolver}, {@code InMemoryRateLimiter}). No other module depends on
 * this one; the Modulith verification test is what holds that, and what keeps {@code project}
 * from coming to depend on it.
 *
 * <p>Every bean here is behind {@link ConditionalOnAnalyticsEnabled}, which is off by default.
 */
package io.github.tarka1939.mysite.analytics;
