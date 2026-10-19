package io.github.tarka1939.mysite.analytics;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.HexFormat;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicReference;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

import org.springframework.stereotype.Component;

/**
 * Who a visitor is, for one UTC day: hex {@code HMAC-SHA256(salt, client)} under a salt of 32
 * random bytes that exists only in this object and is replaced on the first use in each new UTC
 * day (docs/DECISIONS.md, 2026-10-18 analytics ADR, decision 2). The client is
 * {@code ClientIpResolver.resolveNetwork}'s key: an IPv4 address, or an IPv6 address reduced to
 * its {@code /64} (#314).
 *
 * <h2>Why a salt that is thrown away</h2>
 * There are only about four billion IPv4 addresses, so an unsalted hash of one, or one under a
 * salt that is kept, is reversed by trying them all. {@code ClientIpHasher} is exactly that
 * unsalted hash, which is fine for a rate-limit key and wrong here, so it is not used. Once a
 * day's salt is gone nothing can link that day's hashes to an address or to the next day's.
 *
 * <h2>Never written anywhere</h2>
 * The salt, the address and the hash are never logged, at any level, by this class or its callers.
 * Nothing here has a {@code toString()} that could print the salt: {@link DailySalt} is a class
 * rather than a record precisely because a record's generated {@code toString()} prints every
 * component, and both it and this class override {@code toString()} to say so.
 *
 * <p>"Dropped" means unreachable. The bytes stay on the heap until the collector reclaims them,
 * and are not zeroed on rotation, because a request that picked up yesterday's salt just before
 * the swap may still be hashing with it. A heap dump of the running process is outside what this
 * defends against.
 *
 * <h2>Rotation is a check-then-act, made atomic</h2>
 * "Is the salt I hold for today? If not, make one" is the shape CLAUDE.md's checklist names. Two
 * requests just after midnight both see yesterday's salt; done as a plain read-then-set, each makes
 * its own salt for the new day, the two hash the same visitor differently, and the dedup index
 * counts that visitor twice. So the day and its key live together in one {@link AtomicReference},
 * replaced only by {@code compareAndSet} against the value that was read: the loser of a race
 * discards the salt it made and re-reads the winner's. Every caller for a given day therefore gets
 * the one salt that day ever has.
 *
 * <h2>A request that read yesterday's date after today's salt exists</h2>
 * A request can read the clock at 23:59:59.999 and reach the reference after another request has
 * already rotated it to the new day. Making a second salt for yesterday would hash yesterday under
 * two salts, and swapping the reference back to yesterday would then make a second salt for today
 * on the next request. Neither is acceptable, so such a request gets no hash and its event is
 * dropped ({@link #identify} returns empty). The same applies if the system clock steps backwards
 * across midnight. The cost is an event or two at the instant of midnight.
 *
 * <h2>Known gap: the previous salt lives until the next event</h2>
 * Rotation is lazy, on the first event of a new day, which needs no scheduler. Until that event
 * arrives, yesterday's salt stays in memory: for a moment after midnight on a busy day, and for as
 * long as the site goes without an event on a quiet one. The ADR says so. No new hash can be
 * made under it once the day has changed, since {@link #identify} only ever uses the salt for the
 * day it has just read.
 */
@Component
@ConditionalOnAnalyticsEnabled
class DailyVisitorHasher {

    static final int SALT_BYTES = 32;
    private static final String HMAC_ALGORITHM = "HmacSHA256";

    private final Clock clock;
    private final SecureRandom random;
    private final AtomicReference<DailySalt> current = new AtomicReference<>();

    /** The production constructor: UTC days, a platform {@link SecureRandom}. */
    DailyVisitorHasher() {
        this(Clock.systemUTC(), new SecureRandom());
    }

    /** Test seam: a clock that can cross midnight, and a random source that can be observed. */
    DailyVisitorHasher(Clock clock, SecureRandom random) {
        // UTC whatever zone the clock was built with: the ADR's days are UTC days, and a day read
        // in another zone would put a visitor's evening events under the next day's salt.
        this.clock = clock.withZone(ZoneOffset.UTC);
        this.random = random;
    }

    /**
     * The UTC day, read once, and this client's hash for that day. The caller must use the
     * returned day for {@code occurred_on}: it is the day the salt belongs to, and reading the
     * clock a second time could disagree with it across midnight.
     *
     * @return empty when today's salt can no longer be had for the day the clock just gave -- see
     *     the class javadoc -- in which case the event is dropped
     */
    Optional<VisitorDay> identify(String client) {
        LocalDate day = LocalDate.now(clock);
        return saltFor(day).map(salt -> new VisitorDay(day, salt.hmacHex(client)));
    }

    private Optional<DailySalt> saltFor(LocalDate day) {
        while (true) {
            DailySalt held = current.get();
            if (held != null && held.day.equals(day)) {
                return Optional.of(held);
            }
            if (held != null && held.day.isAfter(day)) {
                // Another request has already moved to a later day; see the class javadoc.
                return Optional.empty();
            }
            DailySalt fresh = DailySalt.generate(day, random);
            if (current.compareAndSet(held, fresh)) {
                return Optional.of(fresh);
            }
            // Lost the race: someone else installed a salt between our read and our swap. Ours is
            // discarded unused, and the loop re-reads theirs.
        }
    }

    @Override
    public String toString() {
        return "DailyVisitorHasher[salt redacted]";
    }

    /**
     * A day and the key for it, held together so that one reference swap replaces both.
     * Deliberately not a record; see the class javadoc.
     */
    private static final class DailySalt {

        private final LocalDate day;
        private final SecretKeySpec key;

        private DailySalt(LocalDate day, SecretKeySpec key) {
            this.day = day;
            this.key = key;
        }

        static DailySalt generate(LocalDate day, SecureRandom random) {
            byte[] salt = new byte[SALT_BYTES];
            random.nextBytes(salt);
            return new DailySalt(day, new SecretKeySpec(salt, HMAC_ALGORITHM));
        }

        String hmacHex(String value) {
            try {
                // A Mac per call: Mac is not thread-safe, and getInstance is cheap next to a
                // database round trip.
                Mac mac = Mac.getInstance(HMAC_ALGORITHM);
                mac.init(key);
                return HexFormat.of().formatHex(mac.doFinal(value.getBytes(StandardCharsets.UTF_8)));
            } catch (GeneralSecurityException e) {
                // HmacSHA256 is a mandatory JCA algorithm and the key is always 32 bytes, so this
                // is unreachable. The message names neither the key nor the value.
                throw new IllegalStateException("HmacSHA256 unavailable", e);
            }
        }

        @Override
        public String toString() {
            return "DailySalt[day=" + day + ", key redacted]";
        }
    }

    /**
     * Who a visitor is on one day.
     *
     * @param day the UTC day the hash belongs to, and the {@code occurred_on} to store
     * @param visitorHash 64 lowercase hex characters
     */
    record VisitorDay(LocalDate day, String visitorHash) {

        /** Overridden so that logging one of these cannot print the hash. */
        @Override
        public String toString() {
            return "VisitorDay[day=" + day + ", visitorHash redacted]";
        }
    }
}
