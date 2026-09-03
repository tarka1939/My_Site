package io.github.tarka1939.mysite;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import org.springframework.stereotype.Component;

/**
 * Fixed-window-ish in-memory rate limiter keyed by an arbitrary string (e.g. an IP hash).
 *
 * <p>Deliberately in-memory rather than DB-backed: unlike {@code ContactMessage} (which has a
 * natural table to query per docs/DATA_MODEL.md), password-reset-request has no per-attempt
 * table, and this project's non-goals rule out multi-instance/horizontal scaling (a single
 * VPS process — see docs/DECISIONS.md), so losing rate-limit state on restart is an acceptable
 * trade-off for not adding a table solely to count requests.
 *
 * <h2>Key contract: one window per key</h2>
 * A given key must always be passed the same {@code window}. This is not a new constraint
 * introduced by eviction — it has always held: calling one key with a short window prunes away
 * hits that a longer-window call on the same key was still counting. All three current callers
 * hold to it by namespacing their keys ({@code "login:"}, {@code "password-reset:"},
 * {@code "password-reset-validate:"}), and since every key is a prefix plus a fixed-length
 * SHA-256 hex hash, keys built from different prefixes differ in length and cannot collide.
 *
 * <h2>Eviction (issue #78)</h2>
 * A key that is never queried again — a one-time visitor — used to sit in the map for the
 * lifetime of the process, because stale timestamps are only pruned by a later call <em>for
 * that same key</em>. Two things bound the map now:
 * <ul>
 *   <li>a bucket that prunes down to empty is dropped rather than stored back, and</li>
 *   <li>once the map grows past {@link #DEFAULT_SWEEP_THRESHOLD} entries, a write sweeps out
 *       every key whose newest hit predates the longest window any caller has asked for.</li>
 * </ul>
 * Sweep-on-write rather than a scheduled task: no {@code @EnableScheduling}, no wiring into
 * {@code AsyncConfig}, and nothing runs on an idle process — which, for a site whose spec rules
 * out real scale, is most of the process lifetime. The threshold is re-armed to twice the
 * surviving size after each sweep, so a run of sweeps that reclaim nothing (every key genuinely
 * live) cannot turn every subsequent call into an O(n) pass.
 *
 * <p>The sweep bound is <em>observed</em>, not assumed: {@link #longestWindow} tracks the
 * largest window any caller has actually passed. Hardcoding "an hour" here — today's longest,
 * from password-reset — would silently under-retain the day a caller with a longer one shows
 * up, and this class is not told what its callers intend.
 *
 * <h2>Why the whole read-modify-write sits inside {@code compute}</h2>
 * Before eviction existed, fetching the bucket with {@code computeIfAbsent} and then
 * synchronizing on it was safe, because nothing ever removed a bucket from the map — the bucket
 * a thread held was guaranteed to still be the map's. The moment anything evicts, that shape
 * becomes the check-then-act race CLAUDE.md lists as a standing risk here: a removal landing
 * between the fetch and the append leaves the appending thread writing into an orphaned deque,
 * its hit uncounted, and whoever can provoke eviction gets free requests past the limit.
 * {@code ConcurrentHashMap.compute} holds the bin lock across the mapping function, so
 * prune-decide-append is atomic against the {@code computeIfPresent} the sweep removes with.
 * Every read and write of a bucket therefore happens under that lock and nowhere else, which is
 * also why a plain {@link ArrayDeque} is enough. Both mapping functions are kept short — that is
 * the documented constraint on {@code compute}, and it is why the sweep is triggered after
 * {@code compute} returns rather than from inside it.
 */
@Component
public class InMemoryRateLimiter {

    /**
     * Entries tolerated before a write sweeps. Sized so the real callers (per-IP login,
     * password-reset-request and password-reset-validate buckets on a solo portfolio site) never
     * reach it in normal operation; it exists to cap a flood of one-shot keys, not to tune
     * steady-state behaviour.
     */
    static final int DEFAULT_SWEEP_THRESHOLD = 1024;

    private final Clock clock;
    private final int minSweepThreshold;

    private final ConcurrentHashMap<String, Deque<Instant>> hits = new ConcurrentHashMap<>();

    /** Largest window any caller has passed; monotonic, and the sweep's retention bound. */
    private final AtomicReference<Duration> longestWindow = new AtomicReference<>(Duration.ZERO);

    private final AtomicInteger sweepThreshold;
    private final AtomicBoolean sweepInProgress = new AtomicBoolean();

    public InMemoryRateLimiter() {
        this(Clock.systemUTC());
    }

    InMemoryRateLimiter(Clock clock) {
        this(clock, DEFAULT_SWEEP_THRESHOLD);
    }

    InMemoryRateLimiter(Clock clock, int minSweepThreshold) {
        this.clock = clock;
        this.minSweepThreshold = minSweepThreshold;
        this.sweepThreshold = new AtomicInteger(minSweepThreshold);
    }

    /**
     * Records a hit for {@code key} and returns true if it's within {@code maxHits} over the
     * trailing {@code window}, false if the caller should be rate-limited.
     */
    public boolean tryAcquire(String key, int maxHits, Duration window) {
        Instant now = clock.instant();
        Instant cutoff = now.minus(window);
        // Published before the hit it belongs to lands in the map, so a sweep that can see the
        // hit can also see the window that hit is entitled to be retained for.
        longestWindow.accumulateAndGet(window, (a, b) -> a.compareTo(b) >= 0 ? a : b);

        boolean[] admitted = new boolean[1];
        hits.compute(key, (k, timestamps) -> {
            Deque<Instant> bucket = timestamps == null ? new ArrayDeque<>() : timestamps;
            while (!bucket.isEmpty() && bucket.peekFirst().isBefore(cutoff)) {
                bucket.pollFirst();
            }
            if (bucket.size() < maxHits) {
                bucket.addLast(now);
                admitted[0] = true;
            }
            // Never store an empty bucket: a key that pruned down to nothing is evicted here,
            // atomically with the decision that emptied it.
            return bucket.isEmpty() ? null : bucket;
        });

        if (hits.size() > sweepThreshold.get()) {
            sweepStaleEntries(now);
        }
        return admitted[0];
    }

    /**
     * Removes every key whose newest hit is older than the longest window seen — such a key
     * cannot influence any future decision, since the next call for it would prune the bucket
     * to empty anyway.
     *
     * <p>Removal goes through {@code computeIfPresent} rather than {@code keySet().removeIf} or
     * a bare {@code remove}: those evaluate the predicate outside the bin lock, so a bucket
     * could gain a fresh hit between "looks stale" and "removed", and that hit would vanish.
     * Package-private so tests can drive a sweep at an exact moment.
     */
    void sweepStaleEntries(Instant now) {
        // One sweeper at a time. A caller that skips loses nothing: its entries are still there
        // for the next sweep, and the point is to bound the map, not to bound it this instant.
        if (!sweepInProgress.compareAndSet(false, true)) {
            return;
        }
        try {
            Instant cutoff = now.minus(longestWindow.get());
            for (String key : hits.keySet()) {
                hits.computeIfPresent(key, (k, timestamps) -> {
                    Instant newest = timestamps.peekLast();
                    return newest == null || newest.isBefore(cutoff) ? null : timestamps;
                });
            }
            // Re-arm above what survived, so repeated sweeps that reclaim nothing back off
            // instead of running on every call.
            sweepThreshold.set(
                Math.max(minSweepThreshold, Math.min(hits.size(), Integer.MAX_VALUE / 2) * 2));
        } finally {
            sweepInProgress.set(false);
        }
    }

    /** Keys currently held. Test seam for the eviction behaviour of issue #78. */
    Set<String> trackedKeys() {
        return Set.copyOf(hits.keySet());
    }
}
