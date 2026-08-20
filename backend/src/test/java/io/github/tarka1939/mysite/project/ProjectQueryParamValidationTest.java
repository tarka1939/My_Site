package io.github.tarka1939.mysite.project;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/**
 * Regression/pinning test for the "handler-prefixed parameter path" shape documented in
 * docs/openapi.yaml for {@code ValidationProblemDetail.errors[].field}: for a {@code @Validated}
 * query-param violation (as opposed to a request-body property violation, covered by
 * {@link ProjectWriteRequestValidationTest}), {@code field} is {@code <handlerMethod>.<paramName>}
 * -- e.g. {@code listProjects.size} for the {@code size} query param on {@code listProjects()}.
 *
 * <p>That prefix isn't produced by any code in this project -- it comes from Spring's own
 * method-validation machinery ({@code ConstraintViolationException}'s {@code PropertyPath},
 * formatted by {@link io.github.tarka1939.mysite.GlobalExceptionHandler#handleConstraintViolation}),
 * so it can silently change shape under a Spring upgrade with nothing else in this suite
 * failing. The API contract nonetheless instructs clients not to parse the segment before the
 * dot -- two frontend clients rely on that. If this assertion fails after a dependency bump,
 * the framework's output changed, not this project's code; the fix is to update the documented
 * contract (and the frontend parsers) to match the new shape, not to "correct" this test back
 * to the old string.
 *
 * <p>Asserts the exact value, not a substring/{@code contains} match -- a {@code contains} check
 * would keep passing even if the prefix itself changed shape.
 */
@WebMvcTest(ProjectController.class)
class ProjectQueryParamValidationTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private ProjectService projectService;

    @Test
    void oversizedPageSizeProducesHandlerPrefixedFieldPath() throws Exception {
        mockMvc.perform(get("/api/v1/projects").param("size", "101"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.errors[0].field").value("listProjects.size"));
    }
}
