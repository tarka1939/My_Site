package io.github.tarka1939.mysite.githubsync;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;

import org.junit.jupiter.api.Test;

import io.github.tarka1939.mysite.project.GithubRepositoryMetadata;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * GitHub's payload quirks, pinned. Each case here is a real difference between GitHub's own
 * representations rather than a hypothetical malformed body.
 */
class GithubRepositoryPayloadTest {

    private final ObjectMapper objectMapper = new ObjectMapper();

    private GithubRepositoryMetadata read(String json) {
        JsonNode root = objectMapper.readTree(json);
        return GithubRepositoryPayload.read(root, "tarka1939/Equalizer");
    }

    /**
     * A {@code push} payload -- the event this feature is named after -- carries
     * {@code pushed_at} as Unix epoch seconds, as a JSON number. Reading only the string form
     * would drop the timestamp on exactly the event that matters most.
     */
    @Test
    void pushedAtAsEpochSeconds_isRead() {
        GithubRepositoryMetadata metadata = read("""
            {"repository": {"pushed_at": 1755777600, "default_branch": "main", "archived": false}}
            """);

        assertThat(metadata.lastPushedAt()).isEqualTo(Instant.ofEpochSecond(1755777600L));
        assertThat(metadata.defaultBranch()).isEqualTo("main");
        assertThat(metadata.archived()).isFalse();
    }

    /** The REST representation embedded in most other events uses ISO-8601 instead. */
    @Test
    void pushedAtAsIso8601String_isRead() {
        GithubRepositoryMetadata metadata = read("""
            {"repository": {"pushed_at": "2026-08-21T12:00:00Z", "default_branch": "trunk", "archived": true}}
            """);

        assertThat(metadata.lastPushedAt()).isEqualTo(Instant.parse("2026-08-21T12:00:00Z"));
        assertThat(metadata.defaultBranch()).isEqualTo("trunk");
        assertThat(metadata.archived()).isTrue();
    }

    /**
     * "The delivery said nothing" has to stay distinguishable from "the delivery said false" --
     * a null archived leaves whatever is stored alone, where an unboxed false would un-archive a
     * project on any payload that happened to omit the field.
     */
    @Test
    void fieldsAbsentFromThePayloadReadAsNull_notAsDefaults() {
        GithubRepositoryMetadata metadata = read("""
            {"repository": {"full_name": "tarka1939/Equalizer"}}
            """);

        assertThat(metadata.lastPushedAt()).isNull();
        assertThat(metadata.defaultBranch()).isNull();
        assertThat(metadata.archived()).isNull();
    }

    @Test
    void anUnparseablePushedAtIsIgnoredRatherThanFatal() {
        GithubRepositoryMetadata metadata = read("""
            {"repository": {"pushed_at": "not a timestamp", "default_branch": "main"}}
            """);

        assertThat(metadata.lastPushedAt()).isNull();
        assertThat(metadata.defaultBranch())
            .as("one bad timestamp must not cost the rest of the delivery")
            .isEqualTo("main");
    }

    /**
     * The field this must never carry across. {@code repository.description} is present in every
     * real payload and is the exact value that would destroy the owner's prose; the type
     * crossing the module boundary has no component that could hold it.
     */
    @Test
    void aRepositoryDescriptionHasNowhereToGo() {
        GithubRepositoryMetadata metadata = read("""
            {"repository": {"description": "Auto-generated GitHub blurb", "default_branch": "main"}}
            """);

        assertThat(metadata.toString()).doesNotContain("Auto-generated GitHub blurb");
        assertThat(GithubRepositoryMetadata.class.getRecordComponents())
            .extracting(java.lang.reflect.RecordComponent::getName)
            .containsExactly("repoFullName", "lastPushedAt", "defaultBranch", "archived");
    }
}
