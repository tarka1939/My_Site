package io.github.tarka1939.mysite;

import java.util.List;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * One consistent error shape for the whole API, matching docs/openapi.yaml's RFC 7807
 * ProblemDetail / ValidationProblemDetail conventions.
 */
@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ProblemDetail handleValidation(MethodArgumentNotValidException ex) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(
            HttpStatus.BAD_REQUEST, "Request failed validation");
        problem.setTitle("Validation Failed");

        List<FieldErrorDetail> errors = ex.getBindingResult().getFieldErrors().stream()
            .map(fe -> new FieldErrorDetail(fe.getField(), fe.getDefaultMessage()))
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
     * Fallback for anything not handled above (NPE, DataAccessException, etc.) — without this,
     * an unexpected exception falls through to Spring Boot's default error response instead of
     * the RFC 7807 shape every other error on this API uses. Deliberately doesn't echo
     * {@code ex.getMessage()} to the client, since an unanticipated exception's message could
     * contain internal details (SQL, file paths); logs the full exception server-side instead.
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
