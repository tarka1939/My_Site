package io.github.tarka1939.mysite;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

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

        assertThat(key.getAlgorithm()).isEqualTo("HmacSHA256");
    }
}
