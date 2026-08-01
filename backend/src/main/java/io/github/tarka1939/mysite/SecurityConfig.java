package io.github.tarka1939.mysite;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.web.SecurityFilterChain;

/**
 * Phase 1 placeholder: the Security starter is wired in now (per SPEC.md's confirmed JWT
 * auth scope) so the dependency and filter chain exist, but Phase 2 owns the actual
 * login endpoint, JWT filter, and {@code @PreAuthorize} guards on write endpoints. Until
 * then every request is permitted — replace this with real bearer-token rules in Phase 2.
 */
@Configuration
@EnableWebSecurity
public class SecurityConfig {

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        http
            .csrf(csrf -> csrf.disable())
            .authorizeHttpRequests(auth -> auth.anyRequest().permitAll());
        return http.build();
    }
}
