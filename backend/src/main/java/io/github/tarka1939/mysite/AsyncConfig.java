package io.github.tarka1939.mysite;

import java.util.concurrent.RejectedExecutionHandler;
import java.util.concurrent.ThreadPoolExecutor;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

/**
 * The "taskExecutor" bean every {@code @Async} method in this application runs on.
 *
 * <p>Provisioned in Phase 1 ahead of any consumer. Its first and, as of #186, only consumer is
 * {@code ContactNotificationListener}, which emails the owner when the contact form is used; the
 * Phase 7d DSP demo is expected to be the second. That change of consumer matters, because the
 * listener sits on the tail of a visitor's request rather than on a batch job, and it is what the
 * rejection handler below exists for.
 *
 * <h2>Why a rejection handler is not optional here</h2>
 *
 * <p>{@code ContactNotificationListener} is {@code @Async} + {@code @TransactionalEventListener}
 * bound to {@code AFTER_COMMIT}, and it catches its own {@code RuntimeException}s. That catch
 * cannot protect the {@code @Async} <em>dispatch</em>, which happens before the method body runs:
 * {@code AsyncExecutionAspectSupport#doSubmit} calls {@code executor.submit(...)} outside any
 * try/catch of ours. With the JDK default {@link ThreadPoolExecutor.AbortPolicy}, a full pool plus
 * a full queue makes that submit throw {@code TaskRejectedException}, and the listener's own
 * {@code catch} cannot cover it because the dispatch happens before the method body runs.
 *
 * <p><b>Measured, that does not reach the visitor on Spring Framework 7.0.8.</b> A review
 * predicted it would — escaping {@code commit()} and returning a 500 for a message already durable
 * in the database — and the trace was wrong about the phase.
 * {@code TransactionalApplicationListenerSynchronization$PlatformSynchronization} declares no
 * {@code afterCommit()} at all; it dispatches {@code AFTER_COMMIT} from {@code afterCompletion(int)},
 * and {@code TransactionSynchronizationUtils#invokeAfterCompletion} catches {@code Throwable} where
 * its neighbour {@code invokeAfterCommit} does not. With the handler removed, all 70 submissions in
 * {@code ContactNotificationIntegrationTest} still returned 201; the cost was twelve
 * {@code TaskRejectedException} stack traces at ERROR.
 *
 * <p><b>The handler stays anyway, for three reasons that survive that correction.</b> A saturated
 * queue is a capacity condition, not an error, and should not page anyone by logging as one. The
 * swallow is an incidental implementation detail — one overridden hook away from the prediction
 * being exactly right. And {@code taskExecutor} is shared: the Phase 7d DSP demo is its other
 * planned consumer, and a caller invoked from a request thread with no transaction machinery
 * between it and the response would take the throw with nothing catching it.
 *
 * <p>So overflow drops the task and logs it. A dropped notification is the correct trade: the
 * message is saved and readable in the admin panel either way, and telling the visitor their
 * message failed when it did not is strictly worse than the owner not getting an email.
 *
 * <p><strong>Deliberately not {@link ThreadPoolExecutor.CallerRunsPolicy}.</strong> That would run
 * the send on the caller's thread, which under {@code AFTER_COMMIT} is the visitor's request
 * thread — reintroducing exactly the hang that
 * {@code ContactNotificationIntegrationTest#slowResend_doesNotHoldTheVisitorsResponseOpen} exists
 * to forbid. Back-pressure is the right answer for a work queue and the wrong one for a request
 * path.
 *
 * <h2>Pool sizing, reviewed rather than retuned</h2>
 *
 * <p>2/8/50 was chosen for a hypothetical batch consumer, so it was re-examined once a
 * request-path consumer appeared. It is kept, on purpose:
 *
 * <ul>
 *   <li>{@link ThreadPoolTaskExecutor} grows past the core size only when the queue is <em>full</em>,
 *       so in practice this is 2 sender threads with 50 waiting, not 8. That is ample for a
 *       portfolio contact form whose own rate limiter caps a single IP at 5 messages an hour.</li>
 *   <li>Each queued task now has a bounded duration — {@code ResendEmailClient} has explicit
 *       connect and read timeouts, so the worst case is ~10s per send rather than forever. Before
 *       that fix no pool size would have helped: hung threads never return and the queue never
 *       drains.</li>
 *   <li>Overflow is now a logged drop rather than a failed request, which turns "the queue is too
 *       small" from an availability bug into a capacity signal visible in the logs.</li>
 * </ul>
 */
@Configuration
@EnableAsync
public class AsyncConfig {

    private static final Logger log = LoggerFactory.getLogger(AsyncConfig.class);

    @Bean("taskExecutor")
    public ThreadPoolTaskExecutor taskExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(2);
        executor.setMaxPoolSize(8);
        executor.setQueueCapacity(50);
        executor.setThreadNamePrefix("async-task-");
        // Before initialize(), which is what builds the underlying ThreadPoolExecutor.
        executor.setRejectedExecutionHandler(dropAndLog());
        executor.initialize();
        return executor;
    }

    /**
     * Discards the rejected task and logs that it happened. Nothing about the task is logged
     * beyond its identity as a rejection: the only current caller carries visitor PII (name,
     * email, message body) in its captured event, and CLAUDE.md keeps that out of the logs at
     * every level.
     */
    private static RejectedExecutionHandler dropAndLog() {
        return (task, executor) -> log.warn(
            "Async task executor saturated ({} active, {} queued) -- dropping a background task. "
                + "Nothing the visitor sees is affected; a contact-form notification email may not "
                + "have been sent, and the message itself is persisted and readable in the admin panel.",
            executor.getActiveCount(), executor.getQueue().size());
    }
}
