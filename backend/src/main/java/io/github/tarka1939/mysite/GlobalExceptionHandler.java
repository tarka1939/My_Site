package io.github.tarka1939.mysite;

import java.util.List;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.context.request.WebRequest;
import org.springframework.web.servlet.mvc.method.annotation.ResponseEntityExceptionHandler;

import jakarta.validation.ConstraintViolationException;

/**
 * One consistent error shape for the whole API, matching docs/openapi.yaml's RFC 7807
 * ProblemDetail / ValidationProblemDetail conventions.
 *
 * <p>Extends {@link ResponseEntityExceptionHandler} rather than reimplementing every case --
 * it already maps the standard Spring MVC exceptions (malformed request body, unsupported
 * HTTP method, unsupported media type, etc.) to the correct 4xx status with a ProblemDetail
 * body, via one {@code @ExceptionHandler} method ({@code handleException}) that dispatches to
 * protected per-type hooks. Customizing one of those cases means overriding the matching hook
 * (e.g. {@link #handleMethodArgumentNotValid}), not declaring a new {@code @ExceptionHandler}
 * for the same type -- that would collide with the base class's own mapping for it and fail
 * at startup ("Ambiguous @ExceptionHandler method mapped"). The generic {@code Exception.class}
 * handler below only ever matches what's left over: exceptions the base class doesn't know
 * about at all (NPE, DataAccessException, anything genuinely unanticipated). An earlier version
 * of this class declared {@code Exception.class} without extending the base class, which meant
 * it caught *everything* -- including a malformed request body, which was then misreported as
 * a 500 instead of the correct 400.
 */
@RestControllerAdvice
public class GlobalExceptionHandler extends ResponseEntityExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    @Override
    protected ResponseEntity<Object> handleMethodArgumentNotValid(
        MethodArgumentNotValidException ex, HttpHeaders headers, HttpStatusCode status, WebRequest request
    ) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(status, "Request failed validation");
        problem.setTitle("Validation Failed");

        List<FieldErrorDetail> errors = ex.getBindingResult().getFieldErrors().stream()
            .map(fe -> new FieldErrorDetail(fe.getField(), fe.getDefaultMessage()))
            .toList();
        problem.setProperty("errors", errors);
        return ResponseEntity.status(status).headers(headers).body(problem);
    }

    @ExceptionHandler(ConstraintViolationException.class)
    public ProblemDetail handleConstraintViolation(ConstraintViolationException ex) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(
            HttpStatus.BAD_REQUEST, "Request failed validation");
        problem.setTitle("Validation Failed");

        List<FieldErrorDetail> errors = ex.getConstraintViolations().stream()
            .map(cv -> new FieldErrorDetail(cv.getPropertyPath().toString(), cv.getMessage()))
            .toList();
        problem.setProperty("errors", errors);
        return problem;
    }

    @ExceptionHandler(ResourceNotFoundException.class)
    public ProblemDetail handleNotFound(ResourceNotFoundException ex) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(HttpStatus.NOT_FOUND, ex.getMessage());
        problem.setTitle("Not Found");
        return problem;
    }

    /**
     * A repoFullName another project already claims. 409 rather than a 400, because nothing
     * about the request is malformed -- it collides with the current state of another resource,
     * and it may well succeed unchanged once that project releases the name.
     *
     * <p>Also carried as a field error, so the admin form can put the message on the offending
     * input rather than in a banner, which is what {@code errorInterceptor}'s
     * {@code fieldErrors} branch expects.
     */
    @ExceptionHandler(DuplicateRepoFullNameException.class)
    public ProblemDetail handleDuplicateRepoFullName(DuplicateRepoFullNameException ex) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(HttpStatus.CONFLICT, ex.getMessage());
        problem.setTitle("Conflict");
        problem.setProperty("errors", List.of(new FieldErrorDetail("repoFullName", ex.getMessage())));
        return problem;
    }

    @ExceptionHandler(RateLimitExceededException.class)
    public ProblemDetail handleRateLimitExceeded(RateLimitExceededException ex) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(HttpStatus.TOO_MANY_REQUESTS, ex.getMessage());
        problem.setTitle("Too Many Requests");
        return problem;
    }

    @ExceptionHandler(InvalidCredentialsException.class)
    public ProblemDetail handleInvalidCredentials(InvalidCredentialsException ex) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(HttpStatus.UNAUTHORIZED, ex.getMessage());
        problem.setTitle("Unauthorized");
        return problem;
    }

    @ExceptionHandler(InvalidResetTokenException.class)
    public ProblemDetail handleInvalidResetToken(InvalidResetTokenException ex) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST, ex.getMessage());
        problem.setTitle("Invalid Reset Token");
        problem.setProperty("errors", List.of(new FieldErrorDetail("token", ex.getMessage())));
        return problem;
    }

    /**
     * A failed webhook signature. 401 rather than 403 on two counts: GitHub's own webhook
     * documentation names 401 for a signature mismatch, and this codebase already answers 401
     * for a credential that was presented and rejected (see
     * {@link #handleInvalidCredentials}). No {@code WWW-Authenticate} header accompanies it,
     * which RFC 9110 would want for a 401 -- but there is no HTTP authentication scheme to
     * challenge with here, and inventing one to satisfy the letter of the spec would tell the
     * caller something untrue about how to authenticate. Noted in docs/openapi.yaml.
     *
     * <p>The message is the exception's fixed text and says nothing about which check failed.
     */
    @ExceptionHandler(InvalidWebhookSignatureException.class)
    public ProblemDetail handleInvalidWebhookSignature(InvalidWebhookSignatureException ex) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(HttpStatus.UNAUTHORIZED, ex.getMessage());
        problem.setTitle("Unauthorized");
        return problem;
    }

    /**
     * A webhook delivery that verified but cannot be processed. Plain ProblemDetail rather than
     * the {@code errors} array shape: there is no form and no field here, and the caller is
     * GitHub, which has no use for per-field validation slots.
     */
    @ExceptionHandler(MalformedWebhookPayloadException.class)
    public ProblemDetail handleMalformedWebhookPayload(MalformedWebhookPayloadException ex) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST, ex.getMessage());
        problem.setTitle("Bad Request");
        return problem;
    }

    /**
     * {@code CONTENT_TOO_LARGE}, not the {@code PAYLOAD_TOO_LARGE} alias: both are 413, but RFC
     * 9110 renamed the reason phrase and Spring keeps the old constant only for compatibility.
     * They are distinct enum constants, so a test comparing {@code HttpStatus} values rather
     * than status codes can fail on the difference -- which is how this was noticed.
     */
    @ExceptionHandler(WebhookPayloadTooLargeException.class)
    public ProblemDetail handleWebhookPayloadTooLarge(WebhookPayloadTooLargeException ex) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(HttpStatus.CONTENT_TOO_LARGE, ex.getMessage());
        problem.setTitle("Payload Too Large");
        return problem;
    }

    /**
     * Fallback for anything not handled above or by the base class (NPE, DataAccessException,
     * etc.) — without this, a truly unexpected exception falls through to Spring Boot's default
     * error response instead of the RFC 7807 shape every other error on this API uses.
     * Deliberately doesn't echo {@code ex.getMessage()} to the client, since an unanticipated
     * exception's message could contain internal details (SQL, file paths); logs the full
     * exception server-side instead.
     */
    @ExceptionHandler(Exception.class)
    public ProblemDetail handleUnexpected(Exception ex) {
        log.error("Unhandled exception", ex);
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(
            HttpStatus.INTERNAL_SERVER_ERROR, "An unexpected error occurred");
        problem.setTitle("Internal Server Error");
        return problem;
    }

    private record FieldErrorDetail(String field, String message) {
    }
}
