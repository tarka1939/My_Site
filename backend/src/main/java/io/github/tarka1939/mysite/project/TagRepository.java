package io.github.tarka1939.mysite.project;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface TagRepository extends JpaRepository<Tag, UUID> {

    Optional<Tag> findByNameIgnoreCase(String name);

    /**
     * Tags attached to at least one project, name-ascending — the listing behind GET /tags.
     *
     * <p>Not {@code findAll}: nothing deletes a tag when its last project stops referencing it,
     * so the table accumulates orphans (six of twenty-six in the first real content load), and
     * an orphan offered in the landing page's "filter by tag" control is a filter value that
     * matches nothing. Deleting orphans on last-reference instead would be a check-then-act
     * write on a row a concurrent project write may be attaching to — the shape that already
     * produced a race in {@link #upsertByName}. Filtering the read has no such hazard; the cost
     * is that stale rows stay in the table, invisible through the API. See docs/openapi.yaml's
     * description of GET /tags.
     *
     * <p>Native, like {@code upsertByName} above, because {@code project_tags} has no JPA entity
     * of its own and {@code Tag} has no inverse {@code projects} association. The JPQL
     * alternative would have to reach the join table through {@code Project}
     * ({@code EXISTS (SELECT 1 FROM Project p JOIN p.tags ...)}), pulling a third table into a
     * subquery that only needs the join rows — or gain a bidirectional mapping existing solely
     * to serve one read.
     *
     * <p>{@code EXISTS} rather than {@code JOIN ... DISTINCT}: a semi-join stops at the first
     * matching row per tag and needs no deduplication pass.
     */
    @Query(value = "SELECT t.* FROM tag t "
        + "WHERE EXISTS (SELECT 1 FROM project_tags pt WHERE pt.tag_id = t.id) "
        + "ORDER BY t.name ASC", nativeQuery = true)
    List<Tag> findAllInUseOrderByNameAsc();

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
