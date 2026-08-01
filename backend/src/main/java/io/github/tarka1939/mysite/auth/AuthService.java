package io.github.tarka1939.mysite.auth;

import java.time.Instant;
import java.time.temporal.ChronoUnit;

import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.stereotype.Service;

import io.github.tarka1939.mysite.InvalidCredentialsException;

@Service
public class AuthService {

    private static final long EXPIRY_MINUTES = 60;

    private final AdminUserRepository adminUserRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtEncoder jwtEncoder;

    public AuthService(AdminUserRepository adminUserRepository, PasswordEncoder passwordEncoder, JwtEncoder jwtEncoder) {
        this.adminUserRepository = adminUserRepository;
        this.passwordEncoder = passwordEncoder;
        this.jwtEncoder = jwtEncoder;
    }

    public LoginResponse login(LoginRequest request) {
        AdminUser adminUser = adminUserRepository.findByUsername(request.username())
            .orElseThrow(() -> new InvalidCredentialsException("Invalid username or password"));

        if (!passwordEncoder.matches(request.password(), adminUser.getPasswordHash())) {
            throw new InvalidCredentialsException("Invalid username or password");
        }

        Instant now = Instant.now();
        Instant expiresAt = now.plus(EXPIRY_MINUTES, ChronoUnit.MINUTES);

        JwtClaimsSet claims = JwtClaimsSet.builder()
            .issuer("mysite-backend")
            .issuedAt(now)
            .expiresAt(expiresAt)
            .subject(adminUser.getUsername())
            .claim("roles", java.util.List.of("ADMIN"))
            .build();

        String token = jwtEncoder.encode(
            JwtEncoderParameters.from(JwsHeader.with(MacAlgorithm.HS256).build(), claims)).getTokenValue();

        return new LoginResponse(token, expiresAt);
    }
}
