package io.github.tarka1939.mysite.project;

import java.time.LocalDate;
import java.util.List;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
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
 *
 * <p>{@code published} and {@code repoFullName} are the two exceptions to that rule, and both
 * are boxed so that "the client said nothing" is distinguishable from "the client said false /
 * null". See {@link #published()}.
 */
@ValidProjectDatePeriod
public record ProjectWriteRequest(
    @NotBlank @Size(max = 200) String title,
    @NotBlank @Size(max = 5000) String description,
    @Size(max = 10) List<@Valid LinkDto> links,
    @Size(max = 20) List<@Size(max = 500) String> images,
    @NotNull List<@NotBlank @Size(max = 50) String> tags,
    LocalDate startedOn,
    LocalDate completedOn,

    /**
     * Whether the project appears on the public site, or null for "leave it as it is".
     *
     * <p>Null-means-unchanged is a deliberate departure from this body's full-replacement
     * semantics, and the reason is that the field is newer than its clients. A PUT from
     * anything written before Phase 7a carries no statement about publication at all, and
     * reading that silence as {@code false} would un-publish a live project the first time
     * someone edited it -- the same "the site goes blank" failure V7's back-fill guards
     * against, arriving through the API instead of through a deploy.
     *
     * <p>On create the same silence means {@code true}: a project typed into the CMS by hand is
     * meant to be live, which is what POST has always done, and changing that would make every
     * existing client silently create invisible projects. Un-publishing therefore needs an
     * explicit {@code false}. Both branches live in {@link ProjectService}.
     */
    Boolean published,

    /**
     * {@code owner/name} of the GitHub repository this project tracks, or null for "leave it as
     * it is" -- same reasoning as {@link #published()}: an older client's PUT is not a request
     * to unlink.
     *
     * <p>The consequence, stated rather than discovered: a link cannot be <em>cleared</em>
     * through this endpoint in Phase 7a, only replaced. That is the lesser of the two evils
     * available while the field is younger than its clients.
     *
     * <p>The pattern matches the contract's and rejects anything that is not exactly two
     * non-empty slash-free segments -- {@code owner/name} is GitHub's whole format, and a value
     * that does not fit it can never match a delivery, so accepting it would only produce a
     * project that silently never syncs.
     */
    @Size(max = 255)
    @Pattern(regexp = "^[^\\s/]+/[^\\s/]+$", message = "must be a GitHub repository as owner/name")
    String repoFullName
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
