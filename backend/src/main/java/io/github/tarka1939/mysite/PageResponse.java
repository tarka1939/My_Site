package io.github.tarka1939.mysite;

import java.util.List;

import org.springframework.data.domain.Page;

/**
 * Shared page wrapper matching docs/openapi.yaml's PageMeta + content shape — used instead of
 * serializing Spring Data's raw {@code Page<T>} directly, which would leak internal
 * pageable/sort metadata not in the public contract.
 */
public record PageResponse<T>(
    List<T> content,
    int page,
    int size,
    long totalElements,
    int totalPages
) {
    public static <S, T> PageResponse<T> from(Page<S> page, List<T> content) {
        return new PageResponse<>(
            content,
            page.getNumber(),
            page.getSize(),
            page.getTotalElements(),
            page.getTotalPages());
    }
}
