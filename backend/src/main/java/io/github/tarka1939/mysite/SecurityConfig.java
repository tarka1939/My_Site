package io.github.tarka1939.mysite;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.web.SecurityFilterChain;

/**
 * Phase 1 placeholder: the Security starter is wired in now (per SPEC.md's confirmed JWT
 * auth scope) so the dependency and filter chain exist, but Phase 2 owns the actual login
 * endpoint, JWT filter, and {@code @PreAuthorize} guards on write endpoints.
 *
 * <p>Split by profile so that an accidental deploy before Phase 2 lands fails closed rather
 * than exposing every endpoint: dev permits everything (so the API is usable locally without
 * a login flow that doesn't exist yet), prod permits only the actuator health endpoint that
 * deploy health checks need and denies everything else. Both chains are replaced wholesale
 * by real bearer-token rules in Phase 2.
 */
@Configuration
@EnableWebSecurity
public class SecurityConfig {

    @Bean
    @Profile("!prod")
    public SecurityFilterChain devSecurityFilterChain(HttpSecurity http) throws Exception {
        http
            .csrf(csrf -> csrf.disable())
            .authorizeHttpRequests(auth -> auth.anyRequest().permitAll());
        return http.build();
    }

    @Bean
    @Profile("prod")
    public SecurityFilterChain prodSecurityFilterChain(HttpSecurity http) throws Exception {
        http
            .csrf(csrf -> csrf.disable())
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/actuator/health").permitAll()
                .anyRequest().denyAll());
        return http.build();
    }
}
