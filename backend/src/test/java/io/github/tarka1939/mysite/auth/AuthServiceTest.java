package io.github.tarka1939.mysite.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;

import io.github.tarka1939.mysite.InvalidCredentialsException;

@ExtendWith(MockitoExtension.class)
class AuthServiceTest {

    @Mock
    private AdminUserRepository adminUserRepository;

    @Mock
    private PasswordEncoder passwordEncoder;

    @Mock
    private JwtEncoder jwtEncoder;

    private AuthService authService;

    @BeforeEach
    void setUp() {
        authService = new AuthService(adminUserRepository, passwordEncoder, jwtEncoder);
    }

    @Test
    void login_withValidCredentials_issuesJwtWithAdminRoleClaim() {
        AdminUser adminUser = newAdminUser("admin", "hashed");
        when(adminUserRepository.findByUsername("admin")).thenReturn(Optional.of(adminUser));
        when(passwordEncoder.matches("correct-password", "hashed")).thenReturn(true);

        Jwt fakeJwt = new Jwt(
            "fake-token", Instant.now(), Instant.now().plusSeconds(3600),
            Map.of("alg", "HS256"), Map.of("sub", "admin"));
        when(jwtEncoder.encode(any(JwtEncoderParameters.class))).thenReturn(fakeJwt);

        LoginResponse response = authService.login(new LoginRequest("admin", "correct-password"));

        assertThat(response.token()).isEqualTo("fake-token");
        assertThat(response.expiresAt()).isAfter(Instant.now());

        ArgumentCaptor<JwtEncoderParameters> captor = ArgumentCaptor.forClass(JwtEncoderParameters.class);
        org.mockito.Mockito.verify(jwtEncoder).encode(captor.capture());
        assertThat(captor.getValue().getClaims().getSubject()).isEqualTo("admin");
        assertThat(captor.getValue().getClaims().getClaimAsStringList("roles")).containsExactly("ADMIN");
    }

    @Test
    void login_withUnknownUsername_throwsInvalidCredentials() {
        when(adminUserRepository.findByUsername("ghost")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> authService.login(new LoginRequest("ghost", "whatever")))
            .isInstanceOf(InvalidCredentialsException.class);
    }

    @Test
    void login_withWrongPassword_throwsInvalidCredentials() {
        AdminUser adminUser = newAdminUser("admin", "hashed");
        when(adminUserRepository.findByUsername("admin")).thenReturn(Optional.of(adminUser));
        when(passwordEncoder.matches("wrong-password", "hashed")).thenReturn(false);

        assertThatThrownBy(() -> authService.login(new LoginRequest("admin", "wrong-password")))
            .isInstanceOf(InvalidCredentialsException.class);
    }

    private AdminUser newAdminUser(String username, String passwordHash) {
        // AdminUser's constructor is protected (JPA-only), but accessible here since this
        // test is in the same package. username has no setter (no "change username"
        // endpoint exists), so that one field still goes through reflection.
        try {
            AdminUser adminUser = new AdminUser();
            setField(adminUser, "id", UUID.randomUUID());
            setField(adminUser, "username", username);
            adminUser.setPasswordHash(passwordHash);
            return adminUser;
        } catch (ReflectiveOperationException e) {
            throw new RuntimeException(e);
        }
    }

    private void setField(Object target, String fieldName, Object value) throws ReflectiveOperationException {
        var field = AdminUser.class.getDeclaredField(fieldName);
        field.setAccessible(true);
        field.set(target, value);
    }
}
