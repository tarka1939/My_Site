package io.github.tarka1939.mysite.project;

import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

/**
 * {@code equals}/{@code hashCode} use the natural key ({@code name}, case-insensitive to
 * match {@code ux_tag_name_lower}) rather than identity or the generated id. Without this,
 * {@link Project#getTags()}'s {@code Set<Tag>} only behaves correctly by accident: within one
 * persistence context Hibernate's first-level cache happens to return the same Java instance
 * for repeated loads of the same row, but that's an implementation detail, not a guarantee --
 * it breaks the moment two {@code Tag} instances for the same row cross a persistence-context
 * boundary (e.g. one loaded fresh, one from an earlier transaction).
 */
@Entity
@Table(name = "tag")
public class Tag {

    @Id
    @GeneratedValue
    private UUID id;

    @Column(nullable = false, length = 50)
    private String name;

    protected Tag() {
        // JPA
    }

    public Tag(String name) {
        this.name = name;
    }

    public UUID getId() {
        return id;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) {
            return true;
        }
        if (!(o instanceof Tag other)) {
            return false;
        }
        return name != null && name.equalsIgnoreCase(other.name);
    }

    @Override
    public int hashCode() {
        // Constant, not name.hashCode(): an entity's hashCode must stay stable for as long as
        // it lives in a hash-based collection, but name can be null (transient instance) or
        // change before persistence. See Vlad Mihalcea's "equals/hashCode with JPA" writeup.
        return getClass().hashCode();
    }
}
