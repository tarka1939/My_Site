package io.github.tarka1939.mysite.project;

import java.time.LocalDate;
import java.util.List;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * Body for project create (POST) and full update (PUT). Matches docs/openapi.yaml's
 * ProjectWriteRequest schema.
 *
 * <p>{@code startedOn}/{@code completedOn} are both optional and both nullable. Because this
 * is also the PUT body, omitting either field on update <em>clears</em> it rather than
 * preserving the stored value -- consistent with the full-replacement semantics already
 * applied to title/description/links/images/tags, and spelled out in the contract so it isn't
 * discovered by accident.
 */
@ValidProjectDatePeriod
public record ProjectWriteRequest(
    @NotBlank @Size(max = 200) String title,
    @NotBlank @Size(max = 5000) String description,
    @Size(max = 10) List<@Valid LinkDto> links,
    @Size(max = 20) List<@Size(max = 500) String> images,
    @NotNull List<@NotBlank @Size(max = 50) String> tags,
    LocalDate startedOn,
    LocalDate completedOn
) {
    public ProjectWriteRequest {
        // links/images are genuinely optional per the contract (default: [], not in
        // "required"). tags is NOT defaulted here on purpose -- it's a required field
        // (docs/openapi.yaml: required: [title, description, tags]), so a missing tags
        // key must fail @NotNull rather than silently becoming an empty list.
        //
        // startedOn/completedOn get no defaulting either: null is their meaningful value
        // (unspecified / ongoing), and the relationship between them is checked by
        // @ValidProjectDatePeriod above rather than here -- a compact-constructor throw
        // would surface as a 400 with no field-level error, or as a 500 if it escaped
        // Jackson's deserialization as something other than a binding failure.
        links = links == null ? List.of() : links;
        images = images == null ? List.of() : images;
    }
}
