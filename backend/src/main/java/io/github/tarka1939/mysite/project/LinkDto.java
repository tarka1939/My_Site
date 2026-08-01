package io.github.tarka1939.mysite.project;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record LinkDto(
    @NotBlank @Size(max = 50) String label,
    @NotBlank @Size(max = 500) String url
) {
}
