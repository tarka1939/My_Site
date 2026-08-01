package io.github.tarka1939.mysite.auth;

import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;

import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.stereotype.Service;

import io.github.tarka1939.mysite.ClientIpHasher;
import io.github.tarka1939.mysite.InMemoryRateLimiter;
import io.github.tarka1939.mysite.InvalidCredentialsException;
import io.github.tarka1939.mysite.RateLimitExceededException;

import jakarta.servlet.http.HttpServletRequest;

@Service
public class AuthService {

    private static final long EXPIRY_MINUTES = 60;

    // Brute-force guard on the one endpoint that gates write access to the entire admin
    // surface -- bcrypt's cost factor slows guessing but doesn't stop it on its own.
    private static final int MAX_LOGIN_ATTEMPTS_PER_WINDOW = 5;
    private static final Duration LOGIN_RATE_LIMIT_WINDOW = Duration.ofMinutes(15);

    private final AdminUserRepository adminUserRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtEncoder jwtEncoder;
    private final ClientIpHasher clientIpHasher;
    private final InMemoryRateLimiter rateLimiter;

    public AuthService(
        AdminUserRepository adminUserRepository,
        PasswordEncoder passwordEncoder,
        JwtEncoder jwtEncoder,
        ClientIpHasher clientIpHasher,
        InMemoryRateLimiter rateLimiter
    ) {
        this.adminUserRepository = adminUserRepository;
        this.passwordEncoder = passwordEncoder;
        this.jwtEncoder = jwtEncoder;
        this.clientIpHasher = clientIpHasher;
        this.rateLimiter = rateLimiter;
    }

    public LoginResponse login(LoginRequest request, HttpServletRequest httpRequest) {
        String ipHash = clientIpHasher.hashOf(httpRequest);
        if (!rateLimiter.tryAcquire(ipHash, MAX_LOGIN_ATTEMPTS_PER_WINDOW, LOGIN_RATE_LIMIT_WINDOW)) {
            throw new RateLimitExceededException("Too many login attempts");
        }

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
            .claim("roles", List.of("ADMIN"))
            .build();

        String token = jwtEncoder.encode(
            JwtEncoderParameters.from(JwsHeader.with(MacAlgorithm.HS256).build(), claims)).getTokenValue();

        return new LoginResponse(token, expiresAt);
    }
}
