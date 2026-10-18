package io.github.tarka1939.mysite.analytics;

import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;

import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import io.github.tarka1939.mysite.InvalidQueryParameterException;

/**
 * The admin's analytics summary (#59). Only exists while analytics is enabled -- see
 * {@link ConditionalOnAnalyticsEnabled}.
 *
 * <p>Denied by default twice over, as {@code AdminProjectController} is: {@code /api/v1/admin/**}
 * matches no {@code permitAll} rule, so it falls to {@code anyRequest().authenticated()}, and the
 * class-level {@code @PreAuthorize} then requires the ADMIN role. One consequence with the flag
 * off: a request with no token is refused by the filter chain before dispatch finds no handler,
 * so it gets a 401, and only an authenticated one sees the 404.
 */
@RestController
@ConditionalOnAnalyticsEnabled
@RequestMapping("/api/v1/admin/analytics")
@PreAuthorize("hasRole('ADMIN')")
public class AdminAnalyticsController {

    /** With neither parameter, the 30 days ending today, today included. */
    static final int DEFAULT_RANGE_DAYS = 30;

    /** A leap year, both ends included: long enough for "the last year", short enough to bound the work. */
    static final int MAX_RANGE_DAYS = 366;

    /**
     * The handler method's name, which prefixes the keys of all four date and range errors: the
     * same {@code method.parameter} form a Bean Validation failure on a query parameter gets.
     * {@code AdminAnalyticsIntegrationTest#theErrorKeyPrefixIsTheHandlersName} pins it to the
     * method's actual name.
     */
    static final String HANDLER_NAME = "getAnalyticsSummary";

    /**
     * The first and last day either end may be. The ISO parser accepts a nine-digit year of either
     * sign, and such a date fails further in as a 500 or is answered as an empty range: Postgres
     * refuses the far future, and {@link LocalDate} arithmetic throws near its own limits.
     */
    static final LocalDate MIN_DATE = LocalDate.of(1, 1, 1);
    static final LocalDate MAX_DATE = LocalDate.of(9999, 12, 31);

    static final String DATE_OUT_OF_RANGE = "must be a date from " + MIN_DATE + " to " + MAX_DATE;
    static final String TO_BEFORE_FROM = "must not be before from";
    static final String RANGE_TOO_LONG = "must make a range of at most " + MAX_RANGE_DAYS + " days, both ends included";

    private final AnalyticsSummaryService summaryService;

    AdminAnalyticsController(AnalyticsSummaryService summaryService) {
        this.summaryService = summaryService;
    }

    /**
     * Days are UTC days and both ends are included. A missing {@code to} is today; a missing
     * {@code from} is 29 days before {@code to}. The range is checked after the defaults are
     * applied, so {@code from} alone, set in the future, is a {@code to}-before-{@code from}
     * error: the {@code to} it is checked against is today. Each end must first lie between
     * {@link #MIN_DATE} and {@link #MAX_DATE}, {@code to} checked first; a default that falls
     * outside them, as it can for a {@code to} in the first weeks of year 1, is refused as
     * {@code from}.
     *
     * <p>A value that does not parse as an ISO date never reaches this method: binding it throws,
     * and {@code ResponseEntityExceptionHandler} answers a plain 400.
     */
    @GetMapping
    public ResponseEntity<AnalyticsSummary> getAnalyticsSummary(
        @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
        @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to
    ) {
        // Read once, so the two defaults cannot straddle midnight.
        LocalDate today = LocalDate.now(ZoneOffset.UTC);
        LocalDate end = to != null ? to : today;
        // Before the default start is derived from it: minusDays throws near LocalDate's own limit.
        if (isOutOfBounds(end)) {
            throw new InvalidQueryParameterException(HANDLER_NAME + ".to", DATE_OUT_OF_RANGE);
        }
        LocalDate start = from != null ? from : end.minusDays(DEFAULT_RANGE_DAYS - 1);
        if (isOutOfBounds(start)) {
            throw new InvalidQueryParameterException(HANDLER_NAME + ".from", DATE_OUT_OF_RANGE);
        }

        if (end.isBefore(start)) {
            throw new InvalidQueryParameterException(HANDLER_NAME + ".to", TO_BEFORE_FROM);
        }
        if (ChronoUnit.DAYS.between(start, end) + 1 > MAX_RANGE_DAYS) {
            throw new InvalidQueryParameterException(HANDLER_NAME + ".from", RANGE_TOO_LONG);
        }
        return ResponseEntity.ok(summaryService.summarize(start, end));
    }

    private static boolean isOutOfBounds(LocalDate date) {
        return date.isBefore(MIN_DATE) || date.isAfter(MAX_DATE);
    }
}
