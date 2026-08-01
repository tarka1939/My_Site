package io.github.tarka1939.mysite.contact;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;

@RestController
@RequestMapping("/api/v1/contact")
public class ContactController {

    private final ContactService contactService;

    public ContactController(ContactService contactService) {
        this.contactService = contactService;
    }

    @PostMapping
    public ResponseEntity<ContactMessageAck> submitContactMessage(
        @Valid @RequestBody ContactMessageWriteRequest request, HttpServletRequest httpRequest
    ) {
        ContactMessageAck ack = contactService.submit(request, httpRequest);
        return ResponseEntity.status(HttpStatus.CREATED).body(ack);
    }
}
