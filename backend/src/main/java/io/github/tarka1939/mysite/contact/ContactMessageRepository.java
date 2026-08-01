package io.github.tarka1939.mysite.contact;

import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

public interface ContactMessageRepository extends JpaRepository<ContactMessage, UUID> {
}
