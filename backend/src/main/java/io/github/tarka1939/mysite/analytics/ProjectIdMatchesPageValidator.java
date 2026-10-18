package io.github.tarka1939.mysite.analytics;

import java.util.Optional;

import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;

/**
 * Implements {@link ProjectIdMatchesPage}.
 *
 * <p>Public for the reason {@code ProjectDatePeriodValidator} gives: outside a Spring context
 * Hibernate Validator instantiates validators through a public no-arg constructor.
 */
public class ProjectIdMatchesPageValidator implements ConstraintValidator<ProjectIdMatchesPage, PageViewRequest> {

    static final String REQUIRED_FOR_PROJECT = "is required when page is project";
    static final String REFUSED_FOR_OTHER_PAGES = "must not be set unless page is project";

    @Override
    public boolean isValid(PageViewRequest request, ConstraintValidatorContext context) {
        if (request == null) {
            return true;
        }
        // A missing or unknown page is reported on page by its own constraints. Judging projectId
        // against a page that is not on the list would add a second error about the same mistake.
        Optional<AnalyticsPage> page = AnalyticsPage.fromWire(request.page());
        if (page.isEmpty()) {
            return true;
        }
        boolean isProjectPage = page.get() == AnalyticsPage.PROJECT;
        if (isProjectPage && request.projectId() == null) {
            return reject(context, REQUIRED_FOR_PROJECT);
        }
        if (!isProjectPage && request.projectId() != null) {
            return reject(context, REFUSED_FOR_OTHER_PAGES);
        }
        return true;
    }

    /** On the projectId node, so it is a FieldError keyed {@code projectId}. */
    private static boolean reject(ConstraintValidatorContext context, String message) {
        context.disableDefaultConstraintViolation();
        context.buildConstraintViolationWithTemplate(message)
            .addPropertyNode("projectId")
            .addConstraintViolation();
        return false;
    }
}
