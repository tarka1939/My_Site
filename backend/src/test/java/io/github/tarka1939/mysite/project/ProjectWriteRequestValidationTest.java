package io.github.tarka1939.mysite.project;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/**
 * Regression test for {@code ProjectWriteRequest.links}' {@code @Valid} placement: it was
 * originally on the {@code List<LinkDto>} container ({@code @Valid List<LinkDto> links}),
 * which Hibernate Validator flags as deprecated (HV000271) and -- more importantly -- moving
 * it to the type argument ({@code List<@Valid LinkDto> links}, matching the pattern already
 * used correctly for {@code images}/{@code tags} in the same record) needs to keep cascading
 * into each {@link LinkDto} element, not silently stop validating them.
 */
@WebMvcTest(ProjectController.class)
class ProjectWriteRequestValidationTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private ProjectService projectService;

    @Test
    void malformedLinkInsideValidTopLevelRequestStillFailsCascadeValidation() throws Exception {
        mockMvc.perform(post("/api/v1/projects")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"title":"Test","description":"Test","links":[{"label":"","url":"https://example.com"}],"tags":[]}
                    """))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.errors[0].field").value("links[0].label"));
    }
}
