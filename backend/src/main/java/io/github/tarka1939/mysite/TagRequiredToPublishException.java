package io.github.tarka1939.mysite;

/**
 * A project write that would leave a published project with no tags (#148). Raised by
 * {@code ProjectService}, which is where the rule lives, and answered as a 400 with a field error
 * on {@code tags} -- the same shape a Bean Validation failure gets, because to the client it is
 * one: the form's tags input is what has to change.
 *
 * <p>The message is fixed and is part of the contract with the admin form, which shows the same
 * words. It is not built from the request, so it can never echo anything back.
 */
public class TagRequiredToPublishException extends RuntimeException {

    public static final String MESSAGE = "At least one tag is required to publish";

    public TagRequiredToPublishException() {
        super(MESSAGE);
    }
}
