package io.github.tarka1939.mysite.analytics;

import static org.assertj.core.api.Assertions.assertThat;

import java.lang.reflect.Field;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.Set;
import java.util.concurrent.BrokenBarrierException;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

import org.junit.jupiter.api.Test;

import io.github.tarka1939.mysite.analytics.DailyVisitorHasher.VisitorDay;

class DailyVisitorHasherTest {

    private static final String IP = "203.0.113.7";
    private static final Instant DAY_ONE_NOON = Instant.parse("2026-10-18T12:00:00Z");
    private static final Instant DAY_ONE_LAST_SECOND = Instant.parse("2026-10-18T23:59:59Z");
    private static final Instant DAY_TWO_FIRST_SECOND = Instant.parse("2026-10-19T00:00:01Z");

    private final MutableClock clock = new MutableClock(DAY_ONE_NOON);
    private final RecordingRandom random = new RecordingRandom();
    private final DailyVisitorHasher hasher = new DailyVisitorHasher(clock, random);

    @Test
    void sameAddressSameDay_givesTheSameHash_andAnotherAddressAnotherHash() {
        VisitorDay first = hasher.identify(IP).orElseThrow();
        clock.set(DAY_ONE_LAST_SECOND);
        VisitorDay later = hasher.identify(IP).orElseThrow();
        VisitorDay other = hasher.identify("203.0.113.8").orElseThrow();

        assertThat(first.day()).isEqualTo(LocalDate.of(2026, 10, 18));
        assertThat(later).isEqualTo(first);
        assertThat(other.visitorHash()).isNotEqualTo(first.visitorHash());
        assertThat(first.visitorHash()).matches("[0-9a-f]{64}");
        assertThat(random.salts()).as("one salt for the whole day").hasSize(1);
    }

    @Test
    void crossingMidnight_makesANewSalt_soTheSameAddressHashesDifferently() {
        clock.set(DAY_ONE_LAST_SECOND);
        VisitorDay dayOne = hasher.identify(IP).orElseThrow();
        clock.set(DAY_TWO_FIRST_SECOND);
        VisitorDay dayTwo = hasher.identify(IP).orElseThrow();

        assertThat(dayOne.day()).isEqualTo(LocalDate.of(2026, 10, 18));
        assertThat(dayTwo.day()).isEqualTo(LocalDate.of(2026, 10, 19));
        assertThat(dayTwo.visitorHash()).isNotEqualTo(dayOne.visitorHash());
        assertThat(random.salts()).hasSize(2);
    }

    @Test
    void theDayIsTheUtcDay_whateverZoneTheClockWasGiven() {
        // 23:30 UTC is already the next day in Warsaw. The hasher must still say the 18th.
        DailyVisitorHasher warsaw = new DailyVisitorHasher(
            new MutableClock(Instant.parse("2026-10-18T23:30:00Z"), ZoneId.of("Europe/Warsaw")), random);

        assertThat(warsaw.identify(IP).orElseThrow().day()).isEqualTo(LocalDate.of(2026, 10, 18));
    }

    @Test
    void theHashIsHexHmacSha256OfTheAddressUnderThe32ByteSalt() throws Exception {
        VisitorDay visitor = hasher.identify(IP).orElseThrow();

        byte[] salt = random.salts().getFirst();
        assertThat(salt).hasSize(DailyVisitorHasher.SALT_BYTES).hasSize(32);
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(salt, "HmacSHA256"));
        String expected = HexFormat.of().formatHex(mac.doFinal(IP.getBytes(StandardCharsets.UTF_8)));
        assertThat(visitor.visitorHash()).isEqualTo(expected);
    }

    @Test
    void aRequestThatReadYesterdayAfterTodaysSaltExists_isDropped_andChangesNothing() {
        clock.set(DAY_TWO_FIRST_SECOND);
        VisitorDay today = hasher.identify(IP).orElseThrow();

        clock.set(DAY_ONE_LAST_SECOND);
        assertThat(hasher.identify(IP)).isEmpty();

        clock.set(DAY_TWO_FIRST_SECOND);
        assertThat(hasher.identify(IP)).contains(today);
        assertThat(random.salts()).as("no salt made for yesterday, and today's kept").hasSize(1);
    }

    /**
     * The rotation race, forced rather than hoped for. Every thread is held inside
     * {@code nextBytes} until all of them are there, so every one has already read yesterday's
     * salt and decided to make a new one before any of them can install it. A plain
     * read-then-set would then hand each thread the salt it made itself, and the one visitor would
     * get as many hashes as there are threads. The compare-and-set gives one.
     */
    @Test
    void concurrentFirstRequestsOfANewDay_allGetTheOneSalt() throws Exception {
        int threads = 8;
        hasher.identify(IP).orElseThrow();
        clock.set(DAY_TWO_FIRST_SECOND);
        random.holdUntil(new CyclicBarrier(threads));

        ExecutorService pool = Executors.newFixedThreadPool(threads);
        try {
            List<Future<VisitorDay>> results = new ArrayList<>();
            for (int i = 0; i < threads; i++) {
                results.add(pool.submit(() -> hasher.identify(IP).orElseThrow()));
            }
            Set<String> hashes = ConcurrentHashMap.newKeySet();
            for (Future<VisitorDay> result : results) {
                VisitorDay visitor = result.get(10, TimeUnit.SECONDS);
                assertThat(visitor.day()).isEqualTo(LocalDate.of(2026, 10, 19));
                hashes.add(visitor.visitorHash());
            }

            assertThat(random.salts()).as("every thread made a salt: the race really happened")
                .hasSize(1 + threads);
            assertThat(hashes).as("but only one of them is ever used").hasSize(1);
            // And it stays the day's salt afterwards.
            random.release();
            assertThat(hasher.identify(IP).orElseThrow().visitorHash()).isEqualTo(hashes.iterator().next());
            assertThat(random.salts()).hasSize(1 + threads);
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    void noToStringPrintsTheSaltOrTheHash() throws Exception {
        VisitorDay visitor = hasher.identify(IP).orElseThrow();
        byte[] salt = random.salts().getFirst();

        Field current = DailyVisitorHasher.class.getDeclaredField("current");
        current.setAccessible(true);
        Object dailySalt = ((AtomicReference<?>) current.get(hasher)).get();

        for (String printed : List.of(hasher.toString(), dailySalt.toString(), visitor.toString())) {
            assertThat(printed)
                .doesNotContain(HexFormat.of().formatHex(salt))
                .doesNotContain(HexFormat.of().withUpperCase().formatHex(salt))
                .doesNotContain(Base64.getEncoder().encodeToString(salt))
                .doesNotContain(Arrays.toString(salt))
                .doesNotContain(visitor.visitorHash());
        }
        assertThat(dailySalt.toString()).contains("redacted");
        assertThat(visitor.toString()).contains("redacted");
    }

    /** A clock the test moves. {@code withZone} shares the instant, as the hasher relies on. */
    private static final class MutableClock extends Clock {

        private final AtomicReference<Instant> now;
        private final ZoneId zone;

        MutableClock(Instant start) {
            this(new AtomicReference<>(start), ZoneOffset.UTC);
        }

        MutableClock(Instant start, ZoneId zone) {
            this(new AtomicReference<>(start), zone);
        }

        private MutableClock(AtomicReference<Instant> now, ZoneId zone) {
            this.now = now;
            this.zone = zone;
        }

        void set(Instant instant) {
            now.set(instant);
        }

        @Override
        public ZoneId getZone() {
            return zone;
        }

        @Override
        public Clock withZone(ZoneId newZone) {
            return new MutableClock(now, newZone);
        }

        @Override
        public Instant instant() {
            return now.get();
        }
    }

    /**
     * Distinct, recorded bytes per call, and optionally a barrier every call waits at first. The
     * bytes are not random; they only need to differ, and to be visible to the assertions.
     */
    private static final class RecordingRandom extends SecureRandom {

        private final List<byte[]> salts = new ArrayList<>();
        private final AtomicReference<CyclicBarrier> barrier = new AtomicReference<>();
        private final AtomicBoolean released = new AtomicBoolean();
        private int calls;

        void holdUntil(CyclicBarrier allArrived) {
            barrier.set(allArrived);
        }

        void release() {
            released.set(true);
        }

        synchronized List<byte[]> salts() {
            return List.copyOf(salts);
        }

        @Override
        public void nextBytes(byte[] bytes) {
            CyclicBarrier waitFor = barrier.get();
            if (waitFor != null && !released.get()) {
                try {
                    waitFor.await(10, TimeUnit.SECONDS);
                } catch (InterruptedException | BrokenBarrierException | TimeoutException e) {
                    throw new IllegalStateException("not every thread reached nextBytes", e);
                }
            }
            synchronized (this) {
                calls++;
                Arrays.fill(bytes, (byte) calls);
                salts.add(bytes.clone());
            }
        }
    }
}
