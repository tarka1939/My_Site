package io.github.tarka1939.mysite.analytics;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Set;
import java.util.UUID;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import jakarta.validation.ValidatorFactory;

/** {@link PageViewRequest}'s constraints, outside Spring. The HTTP bodies are in the integration test. */
class ProjectIdMatchesPageValidatorTest {

    private static ValidatorFactory factory;
    private static Validator validator;

    @BeforeAll
    static void setUp() {
        factory = Validation.buildDefaultValidatorFactory();
        validator = factory.getValidator();
    }

    @AfterAll
    static void tearDown() {
        factory.close();
    }

    @Test
    void aProjectPageWithItsProjectIsValid() {
        assertThat(validator.validate(new PageViewRequest("project", UUID.randomUUID()))).isEmpty();
    }

    @Test
    void everyOtherPageWithoutAProjectIsValid() {
        for (AnalyticsPage page : AnalyticsPage.values()) {
            if (page != AnalyticsPage.PROJECT) {
                assertThat(validator.validate(new PageViewRequest(page.wireValue(), null))).as(page.name()).isEmpty();
            }
        }
    }

    @Test
    void aProjectPageWithoutAProject_isOneErrorOnProjectId() {
        assertOnlyError(new PageViewRequest("project", null), "projectId", ProjectIdMatchesPageValidator.REQUIRED_FOR_PROJECT);
    }

    @Test
    void anotherPageWithAProject_isOneErrorOnProjectId() {
        assertOnlyError(new PageViewRequest("about", UUID.randomUUID()), "projectId",
            ProjectIdMatchesPageValidator.REFUSED_FOR_OTHER_PAGES);
    }

    @Test
    void aPageOffTheList_isOneErrorOnPage_andNoneOnProjectId() {
        assertOnlyError(new PageViewRequest("admin", UUID.randomUUID()), "page",
            "must be one of about, projects, project, contact, privacy");
    }

    @Test
    void aMissingPage_isOneErrorOnPage() {
        assertOnlyError(new PageViewRequest(null, null), "page", "must not be null");
    }

    private void assertOnlyError(PageViewRequest request, String path, String message) {
        Set<ConstraintViolation<PageViewRequest>> violations = validator.validate(request);
        assertThat(violations).hasSize(1);
        ConstraintViolation<PageViewRequest> violation = violations.iterator().next();
        assertThat(violation.getPropertyPath()).hasToString(path);
        assertThat(violation.getMessage()).isEqualTo(message);
    }
}
