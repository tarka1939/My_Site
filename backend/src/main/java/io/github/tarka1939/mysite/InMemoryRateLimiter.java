package io.github.tarka1939.mysite;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Deque;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentLinkedDeque;

import org.springframework.stereotype.Component;

/**
 * Fixed-window-ish in-memory rate limiter keyed by an arbitrary string (e.g. an IP hash).
 *
 * <p>Deliberately in-memory rather than DB-backed: unlike {@code ContactMessage} (which has a
 * natural table to query per docs/DATA_MODEL.md), password-reset-request has no per-attempt
 * table, and this project's non-goals rule out multi-instance/horizontal scaling (a single
 * VPS process — see docs/DECISIONS.md), so losing rate-limit state on restart is an acceptable
 * trade-off for not adding a table solely to count requests.
 */
@Component
public class InMemoryRateLimiter {

    private final Clock clock;
    private final ConcurrentHashMap<String, Deque<Instant>> hits = new ConcurrentHashMap<>();

    public InMemoryRateLimiter() {
        this(Clock.systemUTC());
    }

    InMemoryRateLimiter(Clock clock) {
        this.clock = clock;
    }

    /**
     * Records a hit for {@code key} and returns true if it's within {@code maxHits} over the
     * trailing {@code window}, false if the caller should be rate-limited.
     */
    public boolean tryAcquire(String key, int maxHits, Duration window) {
        Instant now = clock.instant();
        Instant cutoff = now.minus(window);
        Deque<Instant> timestamps = hits.computeIfAbsent(key, k -> new ConcurrentLinkedDeque<>());

        synchronized (timestamps) {
            while (!timestamps.isEmpty() && timestamps.peekFirst().isBefore(cutoff)) {
                timestamps.pollFirst();
            }
            if (timestamps.size() >= maxHits) {
                return false;
            }
            timestamps.addLast(now);
            return true;
        }
    }
}
