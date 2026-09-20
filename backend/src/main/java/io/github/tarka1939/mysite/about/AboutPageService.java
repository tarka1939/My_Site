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
