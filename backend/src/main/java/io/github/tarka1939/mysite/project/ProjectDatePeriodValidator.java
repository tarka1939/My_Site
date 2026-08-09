package io.github.tarka1939.mysite.project;

import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;

/**
 * Implements {@link ValidProjectDatePeriod}. Both fields absent, and {@code startedOn}
 * without {@code completedOn} (an ongoing project), are valid states -- not missing data.
 *
 * <p>Public, unlike most of this package's internals: outside a Spring context (a plain
 * {@code Validation.buildDefaultValidatorFactory()}, as in this class's unit test) Hibernate
 * Validator instantiates validators reflectively through a public no-arg constructor and
 * fails with HV000064 on a package-private class. Spring's own
 * {@code SpringConstraintValidatorFactory} has no such restriction, so the gap only shows up
 * outside the container -- which is exactly where the logic matrix is cheapest to test.
 */
public class ProjectDatePeriodValidator implements ConstraintValidator<ValidProjectDatePeriod, ProjectWriteRequest> {

    static final String COMPLETED_WITHOUT_START = "must not be set without startedOn";
    static final String COMPLETED_BEFORE_START = "must not precede startedOn";

    @Override
    public boolean isValid(ProjectWriteRequest request, ConstraintValidatorContext context) {
        // null request: not this constraint's business (Bean Validation convention).
        // null completedOn: ongoing, always valid regardless of startedOn.
        if (request == null || request.completedOn() == null) {
            return true;
        }
        if (request.startedOn() == null) {
            return reject(context, COMPLETED_WITHOUT_START);
        }
        if (request.completedOn().isBefore(request.startedOn())) {
            return reject(context, COMPLETED_BEFORE_START);
        }
        // Equal dates are fine -- the contract forbids completedOn *preceding* startedOn,
        // and a project started and finished in the same month is legitimate.
        return true;
    }

    /**
     * Attaches the violation to the {@code completedOn} property instead of the whole object,
     * so Spring's validator adapter turns it into a FieldError and it surfaces in the
     * ValidationProblemDetail {@code errors[]} array with a usable field name.
     */
    private boolean reject(ConstraintValidatorContext context, String message) {
        context.disableDefaultConstraintViolation();
        context.buildConstraintViolationWithTemplate(message)
            .addPropertyNode("completedOn")
            .addConstraintViolation();
        return false;
    }
}
