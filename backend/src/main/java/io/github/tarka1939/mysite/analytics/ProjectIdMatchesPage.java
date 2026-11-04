package io.github.tarka1939.mysite.analytics;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

import jakarta.validation.Constraint;
import jakarta.validation.Payload;

/**
 * Cross-field rule on a page view: {@code projectId} is required when {@code page} is
 * {@code project} and refused for any other page (docs/openapi.yaml's PageViewEvent).
 *
 * <p>Type-level, since neither field can be judged alone, but reported against the
 * {@code projectId} property node, the same way {@code ValidProjectDatePeriod} reports against
 * {@code completedOn}. That makes it an ordinary {@code FieldError}, so it reaches the client
 * through {@code GlobalExceptionHandler#handleMethodArgumentNotValid} and its shared
 * {@code validationProblem} body, exactly like a {@code @NotNull} on the same request.
 *
 * <p>The database holds the same rule ({@code ck_analytics_event_project_id}, V9) as defence in
 * depth; this is the check the API relies on.
 */
@Documented
@Constraint(validatedBy = ProjectIdMatchesPageValidator.class)
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
public @interface ProjectIdMatchesPage {

    String message() default "projectId does not match page";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};
}
