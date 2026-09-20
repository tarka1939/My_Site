package io.github.tarka1939.mysite.about;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * {@code @NotNull} rather than {@code @NotBlank}: an empty body is a valid write and is how the
 * admin clears the page. The 20000 limit is the contract's, counted on the Markdown source.
 */
public record AboutPageWriteRequest(
    @NotNull @Size(max = 20000) String body
) {
}
