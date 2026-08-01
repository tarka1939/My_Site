package io.github.tarka1939.mysite.contact;

import java.util.UUID;

import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import io.github.tarka1939.mysite.PageResponse;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;

/** Admin only, per docs/openapi.yaml — all endpoints here require a valid admin JWT. */
@RestController
@RequestMapping("/api/v1/contact-messages")
@Validated
@PreAuthorize("hasRole('ADMIN')")
public class ContactMessageController {

    private final ContactService contactService;

    public ContactMessageController(ContactService contactService) {
        this.contactService = contactService;
    }

    @GetMapping
    public ResponseEntity<PageResponse<ContactMessageResponse>> listContactMessages(
        @RequestParam(defaultValue = "0") @Min(0) int page,
        @RequestParam(defaultValue = "20") @Min(1) @Max(100) int size
    ) {
        Pageable pageable = PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "createdAt"));
        return ResponseEntity.ok(contactService.listMessages(pageable));
    }

    @GetMapping("/{id}")
    public ResponseEntity<ContactMessageResponse> getContactMessage(@PathVariable UUID id) {
        return ResponseEntity.ok(contactService.getMessage(id));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deleteContactMessage(@PathVariable UUID id) {
        contactService.deleteMessage(id);
        return ResponseEntity.noContent().build();
    }
}
