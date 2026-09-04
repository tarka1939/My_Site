package io.github.tarka1939.mysite;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

class SecurityConfigTest {

    private final SecurityConfig securityConfig = new SecurityConfig();

    @Test
    void jwtSecretKey_shorterThan32Bytes_failsFastAtBeanCreation() {
        assertThatThrownBy(() -> securityConfig.jwtSecretKey("too-short"))
            .isInstanceOf(IllegalStateException.class)
            .hasMessageContaining("32");
    }

    @Test
    void jwtSecretKey_atLeast32Bytes_succeeds() {
        String secret = "a".repeat(32);

        var key = securityConfig.jwtSecretKey(secret);

        assertThat(key.getAlgorithm()).isEqualTo("DELIBERATELY-WRONG-PROVING-CI-FAILS");
    }

    @Test
    void corsConfigurationSource_withNoAllowedOrigins_registersNothing() {
        // The closed default: no registration means no Access-Control-* header on any response,
        // rather than a permissive fallback. An environment that has not named its frontend
        // answers no cross-origin request at all.
        var source = (UrlBasedCorsConfigurationSource) securityConfig.corsConfigurationSource("");

        assertThat(source.getCorsConfigurations()).isEmpty();
    }

    @Test
    void corsConfigurationSource_registersExactOriginsUnderTheApiPathOnly() {
        var source = (UrlBasedCorsConfigurationSource) securityConfig.corsConfigurationSource(
            "https://krzysztof-tarka.netlify.app, https://example.com");

        assertThat(source.getCorsConfigurations()).containsOnlyKeys("/api/**");
        CorsConfiguration configuration = source.getCorsConfigurations().get("/api/**");
        assertThat(configuration.getAllowedOrigins())
            .containsExactly("https://krzysztof-tarka.netlify.app", "https://example.com");
        assertThat(configuration.getAllowedOriginPatterns())
            .as("exact origins only -- a pattern would admit every Netlify deploy preview")
            .isNull();
        assertThat(configuration.getAllowCredentials()).isFalse();
        assertThat(configuration.getAllowedHeaders()).contains("Authorization", "Content-Type");
        assertThat(configuration.getAllowedMethods()).contains("GET", "POST", "PUT", "DELETE");
    }

    @Test
    void corsConfigurationSource_wildcardOrigin_failsFastAtBeanCreation() {
        // Present but wrong. A "*" that was quietly honoured would be a silent downgrade to
        // exactly the exposure the allowlist exists to prevent.
        assertThatThrownBy(() -> securityConfig.corsConfigurationSource("*"))
            .isInstanceOf(IllegalStateException.class)
            .hasMessageContaining("wildcards");
        assertThatThrownBy(() -> securityConfig.corsConfigurationSource("https://*.netlify.app"))
            .isInstanceOf(IllegalStateException.class)
            .hasMessageContaining("wildcards");
    }

    @Test
    void corsConfigurationSource_originThatIsNotBareSchemeHostPort_failsFastAtBeanCreation() {
        // Browsers send scheme://host[:port] and nothing else, so an entry with a trailing slash
        // or a path can never match -- it would look configured and silently allow nothing.
        assertThatThrownBy(() -> securityConfig.corsConfigurationSource("https://example.com/"))
            .isInstanceOf(IllegalStateException.class)
            .hasMessageContaining("trailing slash");
        assertThatThrownBy(() -> securityConfig.corsConfigurationSource("https://example.com/app"))
            .isInstanceOf(IllegalStateException.class)
            .hasMessageContaining("trailing slash");
        assertThatThrownBy(() -> securityConfig.corsConfigurationSource("example.com"))
            .isInstanceOf(IllegalStateException.class)
            .hasMessageContaining("scheme://host");
    }
}
