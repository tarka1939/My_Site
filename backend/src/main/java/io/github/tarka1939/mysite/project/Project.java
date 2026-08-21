package io.github.tarka1939.mysite.project;

import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import org.hibernate.annotations.BatchSize;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.type.SqlTypes;

import jakarta.persistence.CascadeType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.JoinTable;
import jakarta.persistence.ManyToMany;
import jakarta.persistence.Table;

@Entity
@Table(name = "project")
public class Project {

    @Id
    @GeneratedValue
    private UUID id;

    @Column(nullable = false, length = 200)
    private String title;

    @Column(nullable = false, columnDefinition = "text")
    private String description;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(nullable = false, columnDefinition = "jsonb")
    private List<Link> links = new ArrayList<>();

    @JdbcTypeCode(SqlTypes.ARRAY)
    @Column(nullable = false, columnDefinition = "text[]")
    private String[] images = new String[0];

    @ManyToMany(cascade = {CascadeType.PERSIST, CascadeType.MERGE}, fetch = FetchType.LAZY)
    @JoinTable(
        name = "project_tags",
        joinColumns = @JoinColumn(name = "project_id"),
        inverseJoinColumns = @JoinColumn(name = "tag_id")
    )
    // Batches lazy tag-collection loads across a page of projects (one IN query per batch)
    // instead of one query per project -- avoids N+1 when mapping a paginated project list.
    @BatchSize(size = 25)
    private Set<Tag> tags = new HashSet<>();

    // Nullable on purpose: null startedOn means unspecified, null completedOn means the
    // project is ongoing -- a meaningful value, not missing data. The DB additionally
    // enforces that completedOn neither precedes startedOn nor exists without it
    // (ck_project_date_period, V4__project_dates.sql); the primary check is
    // @ValidProjectDatePeriod on the write DTO, which turns a violation into a 400.
    private LocalDate startedOn;

    private LocalDate completedOn;

    /**
     * Whether this project appears on the public site. Public reads filter on it; the admin
     * reads do not.
     *
     * <p>False by default here, and that is the <i>application</i> default: an object created
     * without anyone saying otherwise -- which in practice means one auto-created from a GitHub
     * webhook delivery -- is a draft the owner has not written or approved yet. It is
     * deliberately <b>not</b> the same value as {@code V7}'s backfill for rows that already
     * existed, which is true, because those rows are the live site. See the long comment at the
     * top of {@code V7__project_publication_and_github_fields.sql}; the two values are easy to
     * confuse and expensive to confuse.
     *
     * <p>A project created by hand through the CMS is published unless the request says
     * otherwise -- {@link ProjectService#createProject} sends an explicit value, so this default
     * never applies to that path.
     */
    @Column(nullable = false)
    private boolean published;

    /**
     * The GitHub repository this project tracks, {@code owner/name}, or null for the projects
     * (most of them) that track none. Unique case-insensitively via
     * {@code ux_project_repo_full_name_lower} -- this is what an inbound delivery matches on.
     */
    @Column(name = "repo_full_name", length = 255)
    private String repoFullName;

    // The three GitHub-authoritative fields below are the only three an inbound webhook
    // delivery may write (docs/DECISIONS.md, Phase 7a ADR). They are facts about a repository
    // rather than statements about the work, which is what makes them safe to overwrite
    // automatically -- everything above this line is the owner's and sync never touches it.
    //
    // They have getters but no setters on purpose. Sync does not load an entity and mutate it:
    // ProjectRepository.upsertFromGithub writes all three in one atomic statement whose SET
    // list is the boundary, and a setter here would be an invitation to bypass that.

    @Column(name = "last_pushed_at")
    private Instant lastPushedAt;

    @Column(name = "default_branch", length = 255)
    private String defaultBranch;

    @Column(nullable = false)
    private boolean archived;

    @CreationTimestamp
    @Column(nullable = false, updatable = false)
    private Instant createdAt;

    @UpdateTimestamp
    @Column(nullable = false)
    private Instant updatedAt;

    protected Project() {
        // JPA
    }

    public Project(String title, String description) {
        this.title = title;
        this.description = description;
    }

    public UUID getId() {
        return id;
    }

    public String getTitle() {
        return title;
    }

    public void setTitle(String title) {
        this.title = title;
    }

    public String getDescription() {
        return description;
    }

    public void setDescription(String description) {
        this.description = description;
    }

    /** Defensive copy -- callers can't mutate this entity's internal state through the getter. */
    public List<Link> getLinks() {
        return List.copyOf(links);
    }

    public void setLinks(List<Link> links) {
        this.links = links;
    }

    /** Defensive copy -- arrays are always mutable, so returning {@code images} directly would
     *  let a caller do {@code project.getImages()[0] = ...} and silently corrupt entity state. */
    public String[] getImages() {
        return images.clone();
    }

    public void setImages(String[] images) {
        this.images = images;
    }

    /** Defensive copy, same reasoning as {@link #getLinks()}. */
    public Set<Tag> getTags() {
        return Set.copyOf(tags);
    }

    public void setTags(Set<Tag> tags) {
        this.tags = tags;
    }

    public LocalDate getStartedOn() {
        return startedOn;
    }

    public void setStartedOn(LocalDate startedOn) {
        this.startedOn = startedOn;
    }

    public LocalDate getCompletedOn() {
        return completedOn;
    }

    public void setCompletedOn(LocalDate completedOn) {
        this.completedOn = completedOn;
    }

    public boolean isPublished() {
        return published;
    }

    public void setPublished(boolean published) {
        this.published = published;
    }

    public String getRepoFullName() {
        return repoFullName;
    }

    public void setRepoFullName(String repoFullName) {
        this.repoFullName = repoFullName;
    }

    public Instant getLastPushedAt() {
        return lastPushedAt;
    }

    public String getDefaultBranch() {
        return defaultBranch;
    }

    public boolean isArchived() {
        return archived;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }
}
