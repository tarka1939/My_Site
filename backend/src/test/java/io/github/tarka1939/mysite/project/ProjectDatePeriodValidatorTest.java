package io.github.tarka1939.mysite.project;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.LocalDate;
import java.util.List;
import java.util.Set;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import jakarta.validation.ValidatorFactory;

/**
 * The full startedOn/completedOn matrix at the Bean Validation layer, including the two
 * states that are valid precisely because a field is absent: no dates at all (unspecified)
 * and a start with no end (ongoing). Absence is a meaningful value here, so it gets its own
 * cases rather than being assumed to fall out of the happy path.
 *
 * <p>Status codes and the RFC 7807 error body are asserted separately, over MockMvc, in
 * {@link ProjectDatesWebValidationTest} -- this class covers the logic, that one covers the
 * wire contract.
 */
class ProjectDatePeriodValidatorTest {

    private static ValidatorFactory factory;
    private static Validator validator;

    @BeforeAll
    static void setUpValidator() {
        factory = Validation.buildDefaultValidatorFactory();
        validator = factory.getValidator();
    }

    @AfterAll
    static void tearDownValidator() {
        factory.close();
    }

    @Test
    void bothDatesNull_isValid() {
        assertThat(validate(null, null)).isEmpty();
    }

    @Test
    void startedOnWithoutCompletedOn_isValid_becauseThatMeansOngoing() {
        assertThat(validate(LocalDate.of(2024, 3, 1), null)).isEmpty();
    }

    @Test
    void completedOnAfterStartedOn_isValid() {
        assertThat(validate(LocalDate.of(2024, 3, 1), LocalDate.of(2025, 6, 1))).isEmpty();
    }

    @Test
    void completedOnEqualToStartedOn_isValid() {
        // The contract forbids completedOn *preceding* startedOn; a project that started and
        // finished in the same month is legitimate.
        assertThat(validate(LocalDate.of(2024, 3, 1), LocalDate.of(2024, 3, 1))).isEmpty();
    }

    @Test
    void completedOnBeforeStartedOn_isRejectedOnTheCompletedOnProperty() {
        Set<ConstraintViolation<ProjectWriteRequest>> violations =
            validate(LocalDate.of(2025, 6, 1), LocalDate.of(2024, 3, 1));

        assertThat(violations).hasSize(1);
        ConstraintViolation<ProjectWriteRequest> violation = violations.iterator().next();
        assertThat(violation.getPropertyPath()).hasToString("completedOn");
        assertThat(violation.getMessage()).isEqualTo(ProjectDatePeriodValidator.COMPLETED_BEFORE_START);
    }

    @Test
    void completedOnWithoutStartedOn_isRejectedOnTheCompletedOnProperty() {
        Set<ConstraintViolation<ProjectWriteRequest>> violations =
            validate(null, LocalDate.of(2024, 3, 1));

        assertThat(violations).hasSize(1);
        ConstraintViolation<ProjectWriteRequest> violation = violations.iterator().next();
        assertThat(violation.getPropertyPath()).hasToString("completedOn");
        assertThat(violation.getMessage()).isEqualTo(ProjectDatePeriodValidator.COMPLETED_WITHOUT_START);
    }

    @Test
    void datePeriodViolationDoesNotSuppressOtherFieldViolations() {
        // Regression guard on disableDefaultConstraintViolation(): it must only drop this
        // constraint's own default message, not other constraints' violations on the bean.
        ProjectWriteRequest request = new ProjectWriteRequest(
            "  ".strip(), "Description", List.of(), List.of(), List.of(),
            null, LocalDate.of(2024, 3, 1));

        Set<ConstraintViolation<ProjectWriteRequest>> violations = validator.validate(request);

        assertThat(violations).extracting(v -> v.getPropertyPath().toString())
            .containsExactlyInAnyOrder("title", "completedOn");
    }

    private Set<ConstraintViolation<ProjectWriteRequest>> validate(LocalDate startedOn, LocalDate completedOn) {
        ProjectWriteRequest request = new ProjectWriteRequest(
            "Equalizer", "A DSP project", List.of(), List.of(), List.of("dsp"), startedOn, completedOn);
        return validator.validate(request);
    }
}
