package io.github.tarka1939.mysite.project;

import java.util.List;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * Body for project create (and, once Phase 2 adds it, full update). Matches
 * docs/openapi.yaml's ProjectWriteRequest schema. Only the create path is wired up in
 * Phase 1 — see {@link ProjectController}.
 */
public record ProjectWriteRequest(
    @NotBlank @Size(max = 200) String title,
    @NotBlank @Size(max = 5000) String description,
    @Size(max = 10) List<@Valid LinkDto> links,
    @Size(max = 20) List<@Size(max = 500) String> images,
    @NotNull List<@NotBlank @Size(max = 50) String> tags
) {
    public ProjectWriteRequest {
        // links/images are genuinely optional per the contract (default: [], not in
        // "required"). tags is NOT defaulted here on purpose -- it's a required field
        // (docs/openapi.yaml: required: [title, description, tags]), so a missing tags
        // key must fail @NotNull rather than silently becoming an empty list.
        links = links == null ? List.of() : links;
        images = images == null ? List.of() : images;
    }
}
