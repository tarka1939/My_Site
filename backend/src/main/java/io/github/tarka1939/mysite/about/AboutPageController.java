package io.github.tarka1939.mysite.about;

import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import jakarta.validation.Valid;

/**
 * Two operations on one resource. The GET is the single new public surface this feature adds and
 * is permitted explicitly in {@code SecurityConfig}; the PUT is covered by the fail-closed
 * {@code anyRequest().authenticated()} rule there and additionally by the role check here, so it
 * required no security change to be protected.
 */
@RestController
@RequestMapping("/api/v1/about")
public class AboutPageController {

    private final AboutPageService service;

    public AboutPageController(AboutPageService service) {
        this.service = service;
    }

    @GetMapping
    public ResponseEntity<AboutPageResponse> getAboutPage() {
        return ResponseEntity.ok(service.get());
    }

    @PutMapping
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<AboutPageResponse> updateAboutPage(
        @Valid @RequestBody AboutPageWriteRequest request
    ) {
        return ResponseEntity.ok(service.replace(request.body()));
    }
}
