package io.github.tarka1939.mysite.project;

import java.util.UUID;

public record TagResponse(UUID id, String name) {

    static TagResponse from(Tag tag) {
        return new TagResponse(tag.getId(), tag.getName());
    }
}
