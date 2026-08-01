package io.github.tarka1939.mysite;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import io.github.tarka1939.mysite.project.ProjectController;
import io.github.tarka1939.mysite.project.ProjectService;

/**
 * Regression test for a real bug this project shipped and a review caught: an earlier
 * {@code @ExceptionHandler(Exception.class)} that didn't extend
 * {@code ResponseEntityExceptionHandler} intercepted standard Spring MVC exceptions (malformed
 * body, wrong method, unsupported media type) before Spring's own correct 4xx mapping ever ran
 * -- misreporting all of them as 500. A {@code @WebMvcTest} slice is enough here (no database
 * needed): these are all rejected before the request would ever reach {@link ProjectService}.
 */
@WebMvcTest(ProjectController.class)
class GlobalExceptionHandlerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private ProjectService projectService;

    @Test
    void malformedRequestBodyIsBadRequestNotInternalServerError() throws Exception {
        mockMvc.perform(post("/api/v1/projects")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{not valid json"))
            .andExpect(status().isBadRequest());
    }

    @Test
    void unsupportedHttpMethodIsMethodNotAllowedNotInternalServerError() throws Exception {
        mockMvc.perform(delete("/api/v1/projects"))
            .andExpect(status().isMethodNotAllowed());
    }

    @Test
    void unsupportedMediaTypeIsUnsupportedMediaTypeNotInternalServerError() throws Exception {
        mockMvc.perform(post("/api/v1/projects")
                .contentType(MediaType.TEXT_PLAIN)
                .content("hello"))
            .andExpect(status().isUnsupportedMediaType());
    }
}
