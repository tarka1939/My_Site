package io.github.tarka1939.mysite.project;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

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

    // ---------------------------------------------------------------------------------------
    // The public reads. Separate methods rather than a publishedOnly flag threaded through the
    // two above, on purpose: "WHERE p.published = true" is then a literal in the query the
    // public endpoints run, with no argument that could arrive false and no caller state that
    // could relax it. A flag would put the site's most public surface one boolean away from
    // serving the owner's unpublished drafts -- which, since drafts are auto-created from
    // whatever repositories get pushed, can include private ones. The duplication is three
    // lines and it is the cheap half of the trade.
    //
    // Supported by ix_project_published_created_at (V7), a partial index on created_at DESC
    // WHERE published -- the filter and the listing's sort in one object.
    // ---------------------------------------------------------------------------------------

    @Query("SELECT p.id FROM Project p WHERE p.published = true")
    Page<UUID> findPublishedIds(Pageable pageable);

    /** The published-only counterpart of {@link #findIdsByTagNamesIgnoreCase}; see its note. */
    @Query("SELECT p.id FROM Project p WHERE p.published = true AND p.id IN "
        + "(SELECT p2.id FROM Project p2 JOIN p2.tags t WHERE LOWER(t.name) IN :tagNames)")
    Page<UUID> findPublishedIdsByTagNamesIgnoreCase(
        @Param("tagNames") List<String> tagNames, Pageable pageable);

    /**
     * Behind the public {@code GET /projects/{id}}. Returns empty for an unpublished project,
     * which the service turns into the same 404 a nonexistent id gets -- deliberately not a
     * 403, which would confirm the id names something real. See docs/openapi.yaml.
     */
    Optional<Project> findByIdAndPublishedTrue(UUID id);

    // ---------------------------------------------------------------------------------------
    // GitHub sync.
    // ---------------------------------------------------------------------------------------

    /**
     * Matches a webhook delivery to a project. Case-insensitive to agree with
     * {@code ux_project_repo_full_name_lower} (V7), which is also the supporting index -- GitHub
     * is not consistent about the case it reports a repository's full name in, and treating two
     * casings as two repositories would create a duplicate draft beside the curated project.
     */
    Optional<Project> findByRepoFullNameIgnoreCase(String repoFullName);

    /**
     * The whole of what a verified GitHub delivery may write, in one atomic statement.
     *
     * <p><b>The SET list is the content boundary.</b> The Phase 7a ADR's first rule is that sync
     * never writes a curated field, and the way that rule is enforced here is structural rather
     * than by review: {@code title}, {@code description}, {@code links}, {@code images},
     * {@code started_on}, {@code completed_on} and the project's tags simply do not appear in the
     * {@code DO UPDATE SET} clause, so no argument to this method can reach them. They appear in
     * the {@code INSERT} half -- a NOT NULL column needs something on the way in -- and that half
     * runs only when no project claims the repository yet, so there is no content to destroy.
     *
     * <p><b>Why an upsert rather than find-then-write.</b> Asking "does a project claim this
     * repository?" and then inserting is the check-then-act shape CLAUDE.md's checklist lists as
     * a standing risk in this codebase, and GitHub supplies the concurrency for free: a push and
     * a release for the same repository arrive together, both find nothing, both insert, and one
     * dies on the unique index. {@code ON CONFLICT ... DO UPDATE} resolves that inside one
     * statement, under the database's own locking, and turns the loser of the race into an
     * update -- which is the right answer, not merely a survivable one.
     *
     * <p>{@code ON CONFLICT (lower(repo_full_name))} infers the expression index from V7. The
     * expression has to be written exactly as the index declares it or Postgres cannot match
     * them and rejects the statement.
     *
     * <p><b>COALESCE on all three GitHub fields.</b> A payload that omits {@code pushed_at} or
     * {@code archived} is saying nothing about them, not saying "null" or "false". Assigning
     * {@code EXCLUDED} unconditionally would let a variant payload erase a known-good value; the
     * COALESCE keeps what is already stored. On the insert side {@code archived} coalesces to
     * false, since the column is NOT NULL and "we have not heard" and "not archived" are the
     * same thing for a repository nobody has told us about.
     *
     * <p>{@code updated_at} moves, because the row did change. That timestamp tracks the record
     * rather than the owner's editing, and the contract says so.
     *
     * @return 1 always (the statement either inserts or updates exactly one row) -- the caller
     *     re-reads to find out which, the same find-after-write shape {@code TagRepository}
     *     already uses
     */
    @Transactional
    // clearAutomatically, because this writes behind Hibernate's back: a native statement leaves
    // the persistence context holding whatever it loaded before, so the caller's re-read would
    // hand back a pre-upsert copy of the row it just changed. flushAutomatically for the mirror
    // of the same problem in the other direction.
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query(value = """
        INSERT INTO project (
            id, title, description, links, images,
            repo_full_name, published, last_pushed_at, default_branch, archived,
            created_at, updated_at)
        VALUES (
            :id, :placeholderTitle, :placeholderDescription, '[]'::jsonb, '{}'::text[],
            :repoFullName, false, :lastPushedAt, :defaultBranch, COALESCE(:archived, false),
            now(), now())
        ON CONFLICT (lower(repo_full_name)) DO UPDATE
           SET last_pushed_at = COALESCE(EXCLUDED.last_pushed_at, project.last_pushed_at),
               default_branch = COALESCE(EXCLUDED.default_branch, project.default_branch),
               archived       = COALESCE(:archived, project.archived),
               updated_at     = now()
        """, nativeQuery = true)
    int upsertFromGithub(
        @Param("id") UUID id,
        @Param("repoFullName") String repoFullName,
        @Param("placeholderTitle") String placeholderTitle,
        @Param("placeholderDescription") String placeholderDescription,
        @Param("lastPushedAt") Instant lastPushedAt,
        @Param("defaultBranch") String defaultBranch,
        @Param("archived") Boolean archived);
}
