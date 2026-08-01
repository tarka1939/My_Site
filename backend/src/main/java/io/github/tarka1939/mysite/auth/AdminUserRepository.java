package io.github.tarka1939.mysite.auth;

import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

public interface AdminUserRepository extends JpaRepository<AdminUser, UUID> {

    Optional<AdminUser> findByUsername(String username);

    Optional<AdminUser> findByEmailIgnoreCase(String email);
}
