package io.github.tarka1939.mysite.auth;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;

@RestController
@RequestMapping("/api/v1/auth")
public class AuthController {

    private final AuthService authService;
    private final PasswordResetService passwordResetService;

    public AuthController(AuthService authService, PasswordResetService passwordResetService) {
        this.authService = authService;
        this.passwordResetService = passwordResetService;
    }

    @PostMapping("/login")
    public ResponseEntity<LoginResponse> login(@Valid @RequestBody LoginRequest request) {
        return ResponseEntity.ok(authService.login(request));
    }

    @PostMapping("/password-reset-request")
    public ResponseEntity<Void> requestPasswordReset(
        @Valid @RequestBody PasswordResetRequestBody request, HttpServletRequest httpRequest
    ) {
        passwordResetService.requestReset(request, httpRequest);
        return ResponseEntity.status(HttpStatus.ACCEPTED).build();
    }

    @PostMapping("/password-reset")
    public ResponseEntity<Void> confirmPasswordReset(@Valid @RequestBody PasswordResetConfirmBody request) {
        passwordResetService.confirmReset(request);
        return ResponseEntity.ok().build();
    }
}
