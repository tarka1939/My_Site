package io.github.tarka1939.mysite;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;

import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;

/**
 * Saturation behaviour of the shared {@code taskExecutor}.
 *
 * <p>The default {@code AbortPolicy} would make {@code executor.submit(...)} throw
 * {@code TaskRejectedException}, and for an {@code @Async} method that throw happens on the
 * <em>caller's</em> thread at dispatch time, before the method body and therefore before any
 * try/catch inside it. For {@code ContactNotificationListener} the caller is the transaction
 * manager committing the visitor's request. Measured, Spring swallows it there rather than
 * returning a 500 -- the dispatch happens in {@code afterCompletion}, which catches
 * {@code Throwable} -- so the observable cost of losing this handler is a stack trace at ERROR
 * per drop, not a failed submission. This class pins the executor's half; the end-to-end
 * consequence is pinned by {@code ContactNotificationIntegrationTest
 * #saturatedExecutor_dropsTheNotificationQuietlyAndStillReturns201}.
 */
class AsyncConfigTest {

    /** 8 max threads + a 50-slot queue: the 59th task is the first that can be rejected. */
    private static final int CAPACITY = 58;

    @Test
    void saturatedExecutor_dropsTheTaskInsteadOfThrowingAtTheSubmitter() {
        ThreadPoolTaskExecutor executor = new AsyncConfig().taskExecutor();
        Logger configLogger = (Logger) LoggerFactory.getLogger(AsyncConfig.class);
        ListAppender<ILoggingEvent> appender = new ListAppender<>();
        appender.start();
        configLogger.addAppender(appender);

        CountDownLatch release = new CountDownLatch(1);
        AtomicInteger overflowTaskRuns = new AtomicInteger();
        try {
            for (int i = 0; i < CAPACITY; i++) {
                executor.execute(() -> await(release));
            }
            // Every thread busy, every queue slot taken. Nothing can accept another task, so the
            // executor has to decide what to do -- and "throw at whoever submitted" is the wrong
            // answer when the submitter is a committing transaction.
            assertThatCode(() -> executor.execute(overflowTaskRuns::incrementAndGet))
                .doesNotThrowAnyException();

            // Dropped, not silently deferred: the point is that the submitter is unharmed, and the
            // drop is visible in the logs rather than invisible.
            assertThat(overflowTaskRuns).hasValue(0);
            assertThat(warnings(appender)).anyMatch(m -> m.contains("Async task executor saturated"));
            // And nothing about a visitor leaked into that warning -- the handler sees an opaque
            // Runnable and must keep it that way.
            assertThat(warnings(appender)).noneMatch(m -> m.contains("@"));
        } finally {
            release.countDown();
            configLogger.detachAppender(appender);
            executor.shutdown();
        }
    }

    private static void await(CountDownLatch latch) {
        try {
            // Bounded, so a failed assertion above cannot leave threads parked for the whole suite.
            latch.await(30, TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    private static List<String> warnings(ListAppender<ILoggingEvent> appender) {
        return List.copyOf(appender.list).stream()
            .filter(e -> e.getLevel().equals(Level.WARN))
            .map(ILoggingEvent::getFormattedMessage)
            .toList();
    }
}
