package io.github.tarka1939.mysite;

/**
 * A query parameter that is well-formed on its own but wrong given the others, such as a date
 * range that ends before it starts. Answered as a 400 with one field error, the same body a Bean
 * Validation failure on a query parameter gets, so a client handles both alike.
 *
 * <p>For rules Bean Validation cannot reach cleanly: the analytics summary's range (#59) is checked
 * after its defaults are filled in from today's date, which a constraint on the raw, possibly
 * absent, parameters would have to repeat. The field key follows the
 * {@code ConstraintViolationException} convention, the handler method's name, a dot and the
 * parameter ({@code getAnalyticsSummary.to}), which is what docs/openapi.yaml documents for
 * every query-parameter violation.
 *
 * <p>Both the key and the message are written by the code that throws, never built from the
 * request, so neither can echo anything back.
 */
public class InvalidQueryParameterException extends RuntimeException {

    private final String field;

    public InvalidQueryParameterException(String field, String message) {
        super(message);
        this.field = field;
    }

    public String field() {
        return field;
    }
}
