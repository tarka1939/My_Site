package io.github.tarka1939.mysite;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

import org.junit.jupiter.api.Test;

/**
 * Covers the limiting behaviour itself and the key eviction added for issue #78 — in
 * particular that eviction cannot swallow a hit, which is the race adding eviction at all
 * introduces (see the class javadoc on {@link InMemoryRateLimiter}).
 */
class InMemoryRateLimiterTest {

    private static final Instant START = Instant.parse("2026-01-01T00:00:00Z");
    private static final Duration WINDOW = Duration.ofMinutes(15);

    // --- limiting behaviour (unchanged by eviction) ---------------------------------------

    @Test
    void admitsExactlyMaxHitsWithinTheWindow() {
        MutableClock clock = new MutableClock(START);
        InMemoryRateLimiter limiter = new InMemoryRateLimiter(clock);

        for (int i = 0; i < 5; i++) {
            assertThat(limiter.tryAcquire("login:x", 5, WINDOW)).as("hit %d", i).isTrue();
        }
        assertThat(limiter.tryAcquire("login:x", 5, WINDOW)).isFalse();
    }

    @Test
    void admitsAgainOnceTheWindowHasElapsed() {
        MutableClock clock = new MutableClock(START);
        InMemoryRateLimiter limiter = new InMemoryRateLimiter(clock);

        for (int i = 0; i < 5; i++) {
            limiter.tryAcquire("login:x", 5, WINDOW);
        }
        assertThat(limiter.tryAcquire("login:x", 5, WINDOW)).isFalse();

        clock.advance(WINDOW.plusSeconds(1));
        assertThat(limiter.tryAcquire("login:x", 5, WINDOW)).isTrue();
    }

    @Test
    void keysAreCountedIndependently() {
        MutableClock clock = new MutableClock(START);
        InMemoryRateLimiter limiter = new InMemoryRateLimiter(clock);

        assertThat(limiter.tryAcquire("login:x", 1, WINDOW)).isTrue();
        assertThat(limiter.tryAcquire("login:x", 1, WINDOW)).isFalse();
        assertThat(limiter.tryAcquire("password-reset:x", 1, WINDOW)).isTrue();
    }

    // --- eviction (issue #78) --------------------------------------------------------------

    @Test
    void aKeyWhoseWindowHasFullyElapsedStopsOccupyingTheMap() {
        MutableClock clock = new MutableClock(START);
        InMemoryRateLimiter limiter = new InMemoryRateLimiter(clock, 2);

        assertThat(limiter.tryAcquire("one-time-visitor", 5, WINDOW)).isTrue();
        clock.advance(WINDOW.plusMinutes(1));

        // Two unrelated later callers push the map past the sweep threshold.
        limiter.tryAcquire("later-a", 5, WINDOW);
        limiter.tryAcquire("later-b", 5, WINDOW);

        assertThat(limiter.trackedKeys()).containsExactlyInAnyOrder("later-a", "later-b");
    }

    @Test
    void oneShotKeysDoNotAccumulateForTheLifetimeOfTheProcess() {
        MutableClock clock = new MutableClock(START);
        InMemoryRateLimiter limiter = new InMemoryRateLimiter(clock, 8);

        // A minute apart with a fifteen-minute window: at most ~16 keys can be live at once,
        // however many visitors have been through. Without eviction this ends at 2000.
        for (int i = 0; i < 2000; i++) {
            limiter.tryAcquire("visitor-" + i, 5, WINDOW);
            clock.advance(Duration.ofMinutes(1));
        }

        assertThat(limiter.trackedKeys()).hasSizeLessThan(100);
    }

    @Test
    void aBucketThatPrunesDownToEmptyIsNotStoredBack() {
        MutableClock clock = new MutableClock(START);
        InMemoryRateLimiter limiter = new InMemoryRateLimiter(clock);

        // maxHits 0 rejects without recording anything, so there is no bucket worth keeping.
        assertThat(limiter.tryAcquire("nobody", 0, WINDOW)).isFalse();
        assertThat(limiter.trackedKeys()).isEmpty();
    }

    @Test
    void sweepRetentionFollowsTheLongestWindowAnyCallerHasUsed() {
        // Only a fifteen-minute caller: a key last seen twenty minutes ago cannot influence
        // any future decision, so it goes.
        MutableClock shortOnly = new MutableClock(START);
        InMemoryRateLimiter shortCallerOnly = new InMemoryRateLimiter(shortOnly);
        shortCallerOnly.tryAcquire("login:x", 5, WINDOW);
        shortOnly.advance(Duration.ofMinutes(20));
        shortCallerOnly.sweepStaleEntries(shortOnly.instant());

        assertThat(shortCallerOnly.trackedKeys()).isEmpty();

        // Same key, same age — but a one-hour caller exists, so twenty minutes is inside the
        // bound this limiter has actually been told about, and nothing may be dropped.
        MutableClock withLong = new MutableClock(START);
        InMemoryRateLimiter bothCallers = new InMemoryRateLimiter(withLong);
        bothCallers.tryAcquire("login:x", 5, WINDOW);
        bothCallers.tryAcquire("password-reset:y", 5, Duration.ofHours(1));
        withLong.advance(Duration.ofMinutes(20));
        bothCallers.sweepStaleEntries(withLong.instant());

        assertThat(bothCallers.trackedKeys()).containsExactlyInAnyOrder("login:x", "password-reset:y");
    }

    @Test
    void aSweepDoesNotForgetHitsThatAreStillInsideTheWindow() {
        MutableClock clock = new MutableClock(START);
        InMemoryRateLimiter limiter = new InMemoryRateLimiter(clock);

        for (int i = 0; i < 5; i++) {
            limiter.tryAcquire("login:x", 5, WINDOW);
        }
        clock.advance(Duration.ofMinutes(1));
        limiter.sweepStaleEntries(clock.instant());

        assertThat(limiter.trackedKeys()).contains("login:x");
        assertThat(limiter.tryAcquire("login:x", 5, WINDOW)).isFalse();
    }

    /**
     * The one that matters. Eviction is what makes "fetch the bucket, then write to it" unsafe:
     * a removal landing in between leaves the writer appending to an orphaned deque, so its hit
     * is never counted and the limit admits more than it should.
     *
     * <p>Each round seeds a key, ages it past the window so a concurrent sweep is entitled to
     * remove it, then releases eight threads at it at once while a sweeper spins. The expected
     * count is exact and interleaving-independent: the seeded hit is stale for every acquirer,
     * so whether the key was evicted, pruned in place, or recreated, exactly {@code maxHits} of
     * the eight may be admitted. A correct implementation cannot fail this for timing reasons
     * — there is no interleaving that produces another number — so it is not a flaky test; what
     * is probabilistic is only how many rounds it takes to catch a broken one.
     */
    @Test
    void concurrentAcquireNeverLosesAHitToEviction() throws Exception {
        MutableClock clock = new MutableClock(START);
        // Threshold 1: every call sweeps, so eviction is maximally in the acquirers' way.
        InMemoryRateLimiter limiter = new InMemoryRateLimiter(clock, 1);
        int maxHits = 2;
        int acquirers = 8;
        int rounds = 2000;

        ExecutorService pool = Executors.newFixedThreadPool(acquirers + 1);
        AtomicBoolean stop = new AtomicBoolean();
        Future<?> sweeper = pool.submit(() -> {
            while (!stop.get()) {
                limiter.sweepStaleEntries(clock.instant());
            }
        });

        try {
            for (int round = 0; round < rounds; round++) {
                String key = "race-" + round;
                assertThat(limiter.tryAcquire(key, maxHits, WINDOW)).isTrue();
                clock.advance(WINDOW.plusMinutes(1));

                CyclicBarrier start = new CyclicBarrier(acquirers);
                List<Future<Boolean>> results = new ArrayList<>();
                for (int i = 0; i < acquirers; i++) {
                    results.add(pool.submit(() -> {
                        start.await();
                        return limiter.tryAcquire(key, maxHits, WINDOW);
                    }));
                }

                int admitted = 0;
                for (Future<Boolean> result : results) {
                    if (result.get(30, TimeUnit.SECONDS)) {
                        admitted++;
                    }
                }
                assertThat(admitted).as("admitted in round %d", round).isEqualTo(maxHits);
            }
        } finally {
            stop.set(true);
            sweeper.get(30, TimeUnit.SECONDS);
            pool.shutdownNow();
        }
    }

    /** Test clock the test moves by hand; volatile because the sweeper thread reads it. */
    private static final class MutableClock extends Clock {

        private volatile Instant instant;

        private MutableClock(Instant instant) {
            this.instant = instant;
        }

        void advance(Duration amount) {
            instant = instant.plus(amount);
        }

        @Override
        public Instant instant() {
            return instant;
        }

        @Override
        public ZoneId getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(ZoneId zone) {
            return this;
        }
    }
}
