package io.github.tarka1939.mysite.about;

import java.time.Instant;

import org.hibernate.annotations.UpdateTimestamp;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

/**
 * The single About page. One row, id 1, created by {@code V8__about_page.sql} and enforced as a
 * singleton by a {@code CHECK (id = 1)} on the primary key -- so there is no code path that creates
 * one, and {@link AboutPageService#get()} treats a missing row as a broken deployment rather than a
 * 404.
 */
@Entity
@Table(name = "about_page")
public class AboutPage {

    /** The only id the CHECK constraint permits. */
    static final short SINGLETON_ID = 1;

    @Id
    private Short id;

    @Column(nullable = false, columnDefinition = "text")
    private String body;

    // Only bumps when Hibernate sees the entity as dirty, so a PUT carrying the body that is
    // already stored leaves updatedAt alone. That is the right reading of "when the body was last
    // replaced" -- and it is why the service uses saveAndFlush, per ProjectService's note.
    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected AboutPage() {
        // JPA
    }

    public Short getId() {
        return id;
    }

    public String getBody() {
        return body;
    }

    public void setBody(String body) {
        this.body = body;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }
}
