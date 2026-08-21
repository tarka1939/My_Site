package io.github.tarka1939.mysite.project;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.nullValue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * The date period over the real HTTP boundary: actual status codes, the RFC 7807
 * ValidationProblemDetail body with field-level errors, and the on-the-wire date format.
 *
 * <p>Every rejection here asserts 400 specifically, not merely "something structured came
 * back" -- the database CHECK constraint (V4__project_dates.sql) would also refuse these
 * writes, but as a 500. That the DTO layer catches them first is the whole point, so the
 * status code is the assertion that matters.
 */
@WebMvcTest(ProjectController.class)
class ProjectDatesWebValidationTest {

    private static final UUID PROJECT_ID = UUID.fromString("f47ac10b-58cc-4372-a567-0e02b2c3d479");

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private ProjectService projectService;

    @Test
    void createWithNoDatesAtAll_isAcceptedAndPassesNullsThrough() throws Exception {
        stubCreate(null, null);

        mockMvc.perform(postProject("""
                {"title":"Ongoing","description":"No dates recorded","tags":[]}
                """))
            .andExpect(status().isCreated())
            // Present-and-null, not omitted -- and now this enforces the contract rather than
            // merely out-performing it. Project lists both dates in `required`, so the generated
            // type is `startedOn: string | null`: clients are entitled to the key always being
            // there and no longer carry an `undefined` case for it. Jackson's default inclusion
            // is what makes that true, so omitting either key here would be a real breach, not
            // just under-delivery. (jsonPath throws on an absent key rather than yielding null,
            // so it does test presence, not merely the value.)
            .andExpect(jsonPath("$.startedOn").value(nullValue()))
            .andExpect(jsonPath("$.completedOn").value(nullValue()));

        assertThat(capturedCreate().startedOn()).isNull();
        assertThat(capturedCreate().completedOn()).isNull();
    }

    @Test
    void createWithExplicitNullDates_isAccepted() throws Exception {
        // Distinct from omitting the keys: the contract marks both nullable, so an explicit
        // null must be accepted rather than rejected as a type mismatch.
        stubCreate(null, null);

        mockMvc.perform(postProject("""
                {"title":"Ongoing","description":"Explicit nulls","tags":[],"startedOn":null,"completedOn":null}
                """))
            .andExpect(status().isCreated());

        assertThat(capturedCreate().startedOn()).isNull();
        assertThat(capturedCreate().completedOn()).isNull();
    }

    @Test
    void createWithStartedOnOnly_isAcceptedAsAnOngoingProject() throws Exception {
        stubCreate(LocalDate.of(2026, 2, 1), null);

        mockMvc.perform(postProject("""
                {"title":"In flight","description":"Still going","tags":[],"startedOn":"2026-02-01"}
                """))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.startedOn").value("2026-02-01"))
            .andExpect(jsonPath("$.completedOn").value(nullValue()));

        assertThat(capturedCreate().startedOn()).isEqualTo(LocalDate.of(2026, 2, 1));
        assertThat(capturedCreate().completedOn()).isNull();
    }

    @Test
    void createWithBothDates_isAcceptedAndSerializesThemAsIsoDates() throws Exception {
        // Guards the wire format the contract specifies (format: date). Jackson writes
        // LocalDate as a [yyyy,mm,dd] array when WRITE_DATES_AS_TIMESTAMPS is on, which
        // would satisfy "a date came back" while breaking the generated client.
        stubCreate(LocalDate.of(2024, 3, 1), LocalDate.of(2025, 6, 1));

        mockMvc.perform(postProject("""
                {"title":"Finished","description":"A whole period","tags":[],
                 "startedOn":"2024-03-01","completedOn":"2025-06-01"}
                """))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.startedOn").value("2024-03-01"))
            .andExpect(jsonPath("$.completedOn").value("2025-06-01"));

        assertThat(capturedCreate().startedOn()).isEqualTo(LocalDate.of(2024, 3, 1));
        assertThat(capturedCreate().completedOn()).isEqualTo(LocalDate.of(2025, 6, 1));
    }

    @Test
    void createWithSameStartAndCompletionDate_isAccepted() throws Exception {
        stubCreate(LocalDate.of(2024, 3, 1), LocalDate.of(2024, 3, 1));

        mockMvc.perform(postProject("""
                {"title":"Weekend build","description":"Started and finished the same month","tags":[],
                 "startedOn":"2024-03-01","completedOn":"2024-03-01"}
                """))
            .andExpect(status().isCreated());
    }

    @Test
    void createWithCompletedOnBeforeStartedOn_is400WithAFieldLevelError() throws Exception {
        mockMvc.perform(postProject("""
                {"title":"Backwards","description":"Ends before it begins","tags":[],
                 "startedOn":"2025-06-01","completedOn":"2024-03-01"}
                """))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.status").value(400))
            .andExpect(jsonPath("$.title").value("Validation Failed"))
            .andExpect(jsonPath("$.errors[0].field").value("completedOn"))
            .andExpect(jsonPath("$.errors[0].message").value(ProjectDatePeriodValidator.COMPLETED_BEFORE_START));

        verifyServiceNeverCalled();
    }

    @Test
    void createWithCompletedOnButNoStartedOn_is400WithAFieldLevelError() throws Exception {
        mockMvc.perform(postProject("""
                {"title":"Finished but never started","description":"Impossible","tags":[],
                 "completedOn":"2024-03-01"}
                """))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.status").value(400))
            .andExpect(jsonPath("$.errors[0].field").value("completedOn"))
            .andExpect(jsonPath("$.errors[0].message").value(ProjectDatePeriodValidator.COMPLETED_WITHOUT_START));

        verifyServiceNeverCalled();
    }

    @Test
    void createWithAnUnparseableDate_is400NotA500() throws Exception {
        mockMvc.perform(postProject("""
                {"title":"Bad date","description":"Not a date at all","tags":[],"startedOn":"march 2024"}
                """))
            .andExpect(status().isBadRequest());

        verifyServiceNeverCalled();
    }

    @Test
    void createWithAnImpossibleCalendarDate_is400NotA500() throws Exception {
        mockMvc.perform(postProject("""
                {"title":"Bad date","description":"No 31st of February","tags":[],"startedOn":"2024-02-31"}
                """))
            .andExpect(status().isBadRequest());

        verifyServiceNeverCalled();
    }

    @Test
    void updateWithCompletedOnBeforeStartedOn_is400() throws Exception {
        // Same body type, same constraint -- PUT must not be a hole in the validation.
        mockMvc.perform(put("/api/v1/projects/" + PROJECT_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"title":"Backwards","description":"Ends before it begins","tags":[],
                     "startedOn":"2025-06-01","completedOn":"2024-03-01"}
                    """))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.errors[0].field").value("completedOn"));

        verifyServiceNeverCalled();
    }

    @Test
    void updateWithCompletedOnButNoStartedOn_is400() throws Exception {
        mockMvc.perform(put("/api/v1/projects/" + PROJECT_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"title":"Finished but never started","description":"Impossible","tags":[],
                     "completedOn":"2024-03-01"}
                    """))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.errors[0].field").value("completedOn"));

        verifyServiceNeverCalled();
    }

    @Test
    void updateOmittingBothDates_reachesTheServiceWithNulls_soTheyAreCleared() throws Exception {
        // The PUT body is a full replacement: an omitted date must arrive at the service as
        // null (clearing the stored value), not be quietly dropped before it gets there.
        when(projectService.updateProject(eq(PROJECT_ID), any(ProjectWriteRequest.class)))
            .thenReturn(response(null, null));

        mockMvc.perform(put("/api/v1/projects/" + PROJECT_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"title":"Cleared","description":"Dates dropped","tags":[]}
                    """))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.startedOn").value(nullValue()))
            .andExpect(jsonPath("$.completedOn").value(nullValue()));

        ArgumentCaptor<ProjectWriteRequest> captor = ArgumentCaptor.forClass(ProjectWriteRequest.class);
        verify(projectService).updateProject(eq(PROJECT_ID), captor.capture());
        assertThat(captor.getValue().startedOn()).isNull();
        assertThat(captor.getValue().completedOn()).isNull();
    }

    private MockHttpServletRequestBuilder postProject(String body) {
        return post("/api/v1/projects").contentType(MediaType.APPLICATION_JSON).content(body);
    }

    private void stubCreate(LocalDate startedOn, LocalDate completedOn) {
        when(projectService.createProject(any(ProjectWriteRequest.class)))
            .thenReturn(response(startedOn, completedOn));
    }

    private ProjectWriteRequest capturedCreate() {
        ArgumentCaptor<ProjectWriteRequest> captor = ArgumentCaptor.forClass(ProjectWriteRequest.class);
        verify(projectService).createProject(captor.capture());
        return captor.getValue();
    }

    private void verifyServiceNeverCalled() {
        verifyNoInteractions(projectService);
    }

    private ProjectResponse response(LocalDate startedOn, LocalDate completedOn) {
        return new ProjectResponse(
            PROJECT_ID, "Title", "Description", List.of(), List.of(), List.of(),
            startedOn, completedOn,
            true, null, null, null, false,
            Instant.parse("2026-08-08T10:00:00Z"), Instant.parse("2026-08-08T10:00:00Z"));
    }
}
