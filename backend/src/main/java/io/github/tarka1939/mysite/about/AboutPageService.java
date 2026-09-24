package io.github.tarka1939.mysite.about;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AboutPageService {

    private final AboutPageRepository repository;

    public AboutPageService(AboutPageRepository repository) {
        this.repository = repository;
    }

    @Transactional(readOnly = true)
    public AboutPageResponse get() {
        return AboutPageResponse.from(load());
    }

    /**
     * Last-write-wins, and knowingly so. Two admins who both load the page and then both save
     * will each see their own text win for as long as it takes the other to press Save: findById
     * takes no lock, the two UPDATEs serialise on the row, and the earlier one is overwritten
     * without anyone being told. No state is corrupted -- a full-replacement PUT with no version
     * or If-Match has exactly these semantics -- and this site has one admin, so the race is
     * accepted rather than fixed, in the same way ContactService.submit accepts its rate-limit
     * race. CLAUDE.md's checklist is clear that accepting one is fine and not noticing one is not;
     * this comment is the noticing.
     */
    @Transactional
    public AboutPageResponse replace(String body) {
        AboutPage page = load();
        page.setBody(body);
        // saveAndFlush, not save: @UpdateTimestamp is populated at flush, which @Transactional
        // defers to commit -- after this method has already built its response. Same trap as
        // ProjectService, same fix.
        return AboutPageResponse.from(repository.saveAndFlush(page));
    }

    /**
     * Absence is an {@link IllegalStateException}, not a {@code ResourceNotFoundException}: the
     * migration creates the row and a CHECK constraint forbids any other, so a missing row means
     * the schema is not the one this code was written against. A 500 is the honest answer to that;
     * a 404 would tell the SPA that a page it has a route for does not exist.
     */
    private AboutPage load() {
        return repository.findById(AboutPage.SINGLETON_ID).orElseThrow(() ->
            new IllegalStateException(
                "about_page row 1 is missing; V8__about_page.sql creates it and must have run"));
    }
}
