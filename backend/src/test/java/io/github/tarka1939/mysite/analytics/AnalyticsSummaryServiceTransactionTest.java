package io.github.tarka1939.mysite.analytics;

import static org.assertj.core.api.Assertions.assertThat;

import java.lang.reflect.Method;
import java.time.LocalDate;

import org.junit.jupiter.api.Test;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

/**
 * What {@link AnalyticsSummaryService#summarize} declares about its transaction. Nothing observable
 * from a single connection fails without it, so the declaration itself is what is pinned.
 */
class AnalyticsSummaryServiceTransactionTest {

    /**
     * REPEATABLE READ gives the summary's three queries one snapshot, so an event inserted between
     * them cannot make a day's total disagree with the page totals by one.
     */
    @Test
    void summarize_readsOneSnapshotInAReadOnlyTransaction() throws NoSuchMethodException {
        Method summarize = AnalyticsSummaryService.class
            .getDeclaredMethod("summarize", LocalDate.class, LocalDate.class);

        Transactional transactional = summarize.getAnnotation(Transactional.class);

        assertThat(transactional).isNotNull();
        assertThat(transactional.readOnly()).isTrue();
        assertThat(transactional.isolation()).isEqualTo(Isolation.REPEATABLE_READ);
    }
}
