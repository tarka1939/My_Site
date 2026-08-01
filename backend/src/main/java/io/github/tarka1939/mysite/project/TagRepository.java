package io.github.tarka1939.mysite.project;

import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface TagRepository extends JpaRepository<Tag, UUID> {

    Optional<Tag> findByNameIgnoreCase(String name);

    /**
     * Upserts by the same case-insensitive uniqueness rule as {@code ux_tag_name_lower} —
     * a no-op if a tag with this name (any case) already exists. Native ON CONFLICT avoids
     * the check-then-act race in a plain findOrCreate (two concurrent requests both missing
     * the find, then both attempting to insert, would otherwise trip the unique index and
     * surface as an uncaught constraint-violation error on one of them).
     */
    @Modifying
    @Query(value = "INSERT INTO tag (id, name) VALUES (gen_random_uuid(), :name) "
        + "ON CONFLICT ((lower(name))) DO NOTHING", nativeQuery = true)
    void upsertByName(@Param("name") String name);
}
