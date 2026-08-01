package io.github.tarka1939.mysite.project;

import java.util.List;
import java.util.UUID;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ProjectRepository extends JpaRepository<Project, UUID> {

    @Query("SELECT p.id FROM Project p")
    Page<UUID> findAllIds(Pageable pageable);

    /**
     * Id-only + re-fetch (not a fetch-joined Page<Project>) deliberately: a fetch join on the
     * project_tags many-to-many collection combined with Pageable produces Hibernate's classic
     * "pagination is applied in-memory" warning/bug, since the join multiplies rows before the
     * LIMIT/OFFSET is applied. {@link #findAllById} then loads the actual entities in a
     * second query.
     *
     * <p>An {@code IN} subquery (not {@code JOIN p.tags t ... SELECT DISTINCT p.id}) is what
     * collapses a project matching multiple tags back to one row: the outer query is a plain
     * {@code FROM Project p} with no join multiplication, so no DISTINCT is needed at all.
     * That matters beyond style -- Postgres rejects {@code SELECT DISTINCT} combined with an
     * {@code ORDER BY} column that isn't in the select list ("for SELECT DISTINCT, ORDER BY
     * expressions must appear in select list"), which the DISTINCT-p.id-with-JOIN version hit
     * for real the moment a Pageable with a createdAt sort reached it -- caught by manual
     * `curl` verification against real Postgres, not by the unsorted Pageable this repository
     * method was originally tested with (see ProjectRepositoryIntegrationTest).
     */
    @Query("SELECT p.id FROM Project p WHERE p.id IN "
        + "(SELECT p2.id FROM Project p2 JOIN p2.tags t WHERE LOWER(t.name) IN :tagNames)")
    Page<UUID> findIdsByTagNamesIgnoreCase(@Param("tagNames") List<String> tagNames, Pageable pageable);
}
