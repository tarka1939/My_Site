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
 * <p>Fails closed by default: permit-all is opt-in via {@code @Profile("dev")}, and every
 * other case -- {@code prod}, any other profile, or no profile set at all -- gets the locked
 * -down chain (only the actuator health endpoint that deploy health checks need; everything
 * else denied). A deploy that forgets to pass {@code -Dspring-boot.run.profiles=prod} (or any
 * profile) still ends up locked down rather than wide open, which an earlier
 * {@code @Profile("!prod")} version got backwards -- that failed <em>open</em> for anything
 * that wasn't literally {@code prod}, including no profile at all. Both chains are replaced
 * wholesale by real bearer-token rules in Phase 2.
 */
@Configuration
@EnableWebSecurity
public class SecurityConfig {

    @Bean
    @Profile("dev")
    public SecurityFilterChain devSecurityFilterChain(HttpSecurity http) throws Exception {
        http
            .csrf(csrf -> csrf.disable())
            .authorizeHttpRequests(auth -> auth.anyRequest().permitAll());
        return http.build();
    }

    @Bean
    @Profile("!dev")
    public SecurityFilterChain lockedDownSecurityFilterChain(HttpSecurity http) throws Exception {
        http
            .csrf(csrf -> csrf.disable())
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/actuator/health").permitAll()
                .anyRequest().denyAll());
        return http.build();
    }
}
