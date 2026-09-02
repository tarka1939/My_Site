package io.github.tarka1939.mysite;

import java.net.URI;
import java.net.URISyntaxException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

import javax.crypto.spec.SecretKeySpec;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationConverter;
import org.springframework.security.oauth2.server.resource.authentication.JwtGrantedAuthoritiesConverter;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.util.StringUtils;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import com.nimbusds.jose.jwk.source.ImmutableSecret;
import com.nimbusds.jose.proc.SecurityContext;

/**
 * Real JWT auth, replacing the Phase 1 permit-all/deny-all placeholder chains. Stateless
 * bearer-token auth via Spring Security's OAuth2 Resource Server support (Nimbus JWT
 * encoder/decoder) -- not hand-rolled token signing, per SPEC.md's "no hand-rolled
 * auth/crypto" non-goal. A single symmetric HS256 secret is sufficient here: one admin
 * account, one backend process issuing and validating its own tokens (no separate
 * authorization server).
 *
 * <p>{@code app.jwt.secret} has no default in the base application.yml, only in
 * application-dev.yml -- prod (and any profile-less run) fails fast at startup if
 * {@code JWT_SECRET} isn't set, following the same "don't fail open when a profile is
 * forgotten" discipline as the Phase 1 SecurityConfig fix (see AGENT_LOG.md).
 */
@Configuration
@EnableWebSecurity
@EnableMethodSecurity
public class SecurityConfig {

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }

    private static final int HS256_MIN_KEY_BYTES = 32;

    @Bean
    public SecretKeySpec jwtSecretKey(@Value("${app.jwt.secret}") String secret) {
        byte[] keyBytes = secret.getBytes(StandardCharsets.UTF_8);
        // Nimbus's MACSigner/MACVerifier reject a key this short too, but only lazily -- on
        // the first login/token-validation call, not at startup. Checking here turns a
        // misconfigured JWT_SECRET into an immediate, actionable boot failure instead of an
        // app that looks healthy until someone actually tries to log in.
        if (keyBytes.length < HS256_MIN_KEY_BYTES) {
            throw new IllegalStateException(
                "app.jwt.secret (JWT_SECRET) must be at least " + HS256_MIN_KEY_BYTES
                    + " bytes for HS256; got " + keyBytes.length);
        }
        return new SecretKeySpec(keyBytes, "HmacSHA256");
    }

    @Bean
    public JwtEncoder jwtEncoder(SecretKeySpec jwtSecretKey) {
        return new NimbusJwtEncoder(new ImmutableSecret<SecurityContext>(jwtSecretKey));
    }

    @Bean
    public JwtDecoder jwtDecoder(SecretKeySpec jwtSecretKey) {
        return NimbusJwtDecoder.withSecretKey(jwtSecretKey).macAlgorithm(MacAlgorithm.HS256).build();
    }

    @Bean
    public JwtAuthenticationConverter jwtAuthenticationConverter() {
        JwtGrantedAuthoritiesConverter authoritiesConverter = new JwtGrantedAuthoritiesConverter();
        authoritiesConverter.setAuthoritiesClaimName("roles");
        authoritiesConverter.setAuthorityPrefix("ROLE_");

        JwtAuthenticationConverter converter = new JwtAuthenticationConverter();
        converter.setJwtGrantedAuthoritiesConverter(authoritiesConverter);
        return converter;
    }

    /**
     * CORS for the deployed frontend (issue #44). Frontend and backend are on different origins
     * by design -- Netlify serves the SPA, a VPS serves this API -- so without this every call
     * from the deployed site fails in the browser.
     *
     * <h2>An exact allowlist, not a wildcard or a pattern</h2>
     * {@code app.cors.allowed-origins} is an exact-match list. Not {@code *}: the SPA sends an
     * {@code Authorization} header, so a permissive origin is a real exposure. Not
     * {@code allowedOriginPatterns} either -- a pattern such as
     * {@code https://*--<site>.netlify.app} would admit every Netlify deploy preview, including
     * previews built from a fork's pull request, i.e. arbitrary third-party JavaScript on an
     * origin this API answers. Deploy previews are therefore deliberately NOT allowlisted; if one
     * ever needs to reach a real backend, add its exact origin to the config for as long as that
     * is true. Fails closed: an empty or unset list registers no CORS configuration at all, so no
     * cross-origin request is answered, rather than defaulting to something permissive.
     *
     * <h2>Configuration rather than a constant</h2>
     * The origin lives in {@code application.yml} under {@code app.cors.allowed-origins}
     * (overridable with {@code CORS_ALLOWED_ORIGINS}) instead of being hardcoded here, because it
     * is deployment data, not a design decision: a custom domain is coming, and it will need to be
     * served alongside the Netlify origin during the switchover. Comma-separated, so that is an
     * env-var edit and a restart rather than a code change. It is not a secret -- the browser
     * sends it on every request -- so it keeps a real default rather than being required.
     *
     * <h2>Credentials</h2>
     * {@code allowCredentials} stays false. The admin JWT travels in an {@code Authorization}
     * header the SPA sets explicitly, which is not a CORS "credential" (that means cookies and
     * TLS client certs), so nothing needs it. If session cookies are ever introduced this must
     * flip to true -- and at that point a wildcard origin becomes impossible anyway, since
     * browsers reject {@code Access-Control-Allow-Origin: *} with credentials.
     *
     * <p>Registered for {@code /api/**} only: {@code /actuator/health} is not called by a browser
     * and gets no CORS headers.
     */
    @Bean
    public CorsConfigurationSource corsConfigurationSource(
        @Value("${app.cors.allowed-origins:}") String allowedOrigins
    ) {
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        List<String> origins = parseAllowedOrigins(allowedOrigins);
        if (origins.isEmpty()) {
            // Nothing registered -> getCorsConfiguration() returns null for every request -> no
            // Access-Control-* headers are written. The closed default, not an open one.
            return source;
        }
        CorsConfiguration configuration = new CorsConfiguration();
        configuration.setAllowedOrigins(origins);
        // Exactly the methods the contract uses (docs/openapi.yaml has no PATCH), plus OPTIONS
        // for the preflight itself.
        configuration.setAllowedMethods(List.of("GET", "POST", "PUT", "DELETE", "OPTIONS"));
        // Named rather than "*": Authorization for the admin JWT, Content-Type for JSON bodies.
        // Accept is CORS-safelisted and needs no permission, but listing it costs nothing and
        // avoids a preflight failure if a client ever sends a non-safelisted Accept value.
        configuration.setAllowedHeaders(List.of("Authorization", "Content-Type", "Accept"));
        configuration.setAllowCredentials(false);
        configuration.setMaxAge(3600L);
        source.registerCorsConfiguration("/api/**", configuration);
        return source;
    }

    private static List<String> parseAllowedOrigins(String commaSeparated) {
        List<String> origins = new ArrayList<>();
        if (!StringUtils.hasText(commaSeparated)) {
            return origins;
        }
        for (String raw : commaSeparated.split(",")) {
            String origin = raw.trim();
            if (origin.isEmpty()) {
                continue;
            }
            // Fail fast at bean creation on a value that is present but malformed, per CLAUDE.md's
            // config-validation rule: a typo'd origin is invisible at runtime (the browser just
            // reports a CORS failure that looks identical to "CORS was never configured"), and
            // "*" here would be a silent downgrade to the exposure this allowlist exists to
            // prevent. Absent is the separate, deliberate case handled above.
            if (origin.equals("*") || origin.contains("*")) {
                throw new IllegalStateException(
                    "app.cors.allowed-origins must list exact origins, not wildcards; got: " + origin);
            }
            URI uri;
            try {
                uri = new URI(origin);
            } catch (URISyntaxException e) {
                throw new IllegalStateException(
                    "app.cors.allowed-origins entry is not a valid origin: " + origin, e);
            }
            boolean schemeOk = "http".equals(uri.getScheme()) || "https".equals(uri.getScheme());
            boolean bareOrigin = uri.getHost() != null
                && !StringUtils.hasLength(uri.getPath())
                && uri.getQuery() == null
                && uri.getFragment() == null
                && uri.getUserInfo() == null;
            if (!schemeOk || !bareOrigin) {
                throw new IllegalStateException(
                    "app.cors.allowed-origins entry must be scheme://host[:port] with no trailing "
                        + "slash or path (browsers send exactly that in the Origin header); got: " + origin);
            }
            origins.add(origin);
        }
        return origins;
    }

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http, JwtAuthenticationConverter jwtAuthenticationConverter) throws Exception {
        http
            // Picks up the CorsConfigurationSource bean above. Configured through Spring Security
            // rather than WebMvcConfigurer#addCorsMappings so that CORS runs inside the security
            // filter chain: a preflight OPTIONS carries no Authorization header, so a chain that
            // authorized before handling CORS would answer it with a 401 the browser reports as a
            // CORS error. This ordering is why no OPTIONS permitAll rule is needed below.
            .cors(Customizer.withDefaults())
            .csrf(csrf -> csrf.disable())
            .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/actuator/health").permitAll()
                .requestMatchers(HttpMethod.GET, "/api/v1/projects", "/api/v1/projects/**").permitAll()
                .requestMatchers(HttpMethod.GET, "/api/v1/tags").permitAll()
                .requestMatchers(HttpMethod.POST, "/api/v1/contact").permitAll()
                .requestMatchers("/api/v1/auth/**").permitAll()
                // Phase 7a's GitHub webhook receiver. Named exactly -- one method, one exact
                // path -- rather than folded into an existing matcher or a "/webhooks/**"
                // wildcard, so this permit cannot quietly grow to cover a future receiver
                // nobody has thought about yet. "Unauthenticated" here means only that the
                // filter chain has no credential to check: the endpoint authenticates its
                // caller by HMAC-SHA256 over the raw request body (GithubSignatureVerifier),
                // which is not something a request matcher can express.
                //
                // Whether the path is mapped at all is a separate and independent gate -- see
                // GithubSyncConfiguration's feature flag, which is off by default. Permitting
                // a path that no handler serves yields a 404, not a hole.
                .requestMatchers(HttpMethod.POST, "/api/v1/webhooks/github").permitAll()
                .anyRequest().authenticated())
            .oauth2ResourceServer(oauth2 -> oauth2
                .jwt(jwt -> jwt.jwtAuthenticationConverter(jwtAuthenticationConverter)));
        return http.build();
    }
}
