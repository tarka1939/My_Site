package io.github.tarka1939.mysite.project;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

import jakarta.validation.Constraint;
import jakarta.validation.Payload;

/**
 * Cross-field check on a project's date period: {@code completedOn} must neither precede
 * {@code startedOn} nor be supplied without it (see docs/openapi.yaml's ProjectWriteRequest
 * and the 2026-08-08 project-dates ADR).
 *
 * <p>Type-level rather than field-level because neither field can be judged on its own -- the
 * validator reports the violation against the {@code completedOn} property node so it still
 * lands in the RFC 7807 {@code errors[]} array as a field-level error, matching every other
 * validation failure on this API.
 *
 * <p>This is the primary enforcement point, producing a clean 400. The
 * {@code ck_project_date_period} CHECK constraint added in V4__project_dates.sql is defence
 * in depth for writes that don't come through this DTO, not the error path the API relies on.
 */
@Documented
@Constraint(validatedBy = ProjectDatePeriodValidator.class)
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
public @interface ValidProjectDatePeriod {

    String message() default "invalid project date period";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};
}
