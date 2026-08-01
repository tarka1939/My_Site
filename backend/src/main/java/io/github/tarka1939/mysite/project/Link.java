package io.github.tarka1939.mysite.project;

/**
 * A single labeled link, stored as one element of {@link Project#getLinks()}'s jsonb array.
 */
public record Link(String label, String url) {
}
