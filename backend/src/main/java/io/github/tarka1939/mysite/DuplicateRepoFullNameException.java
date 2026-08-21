package io.github.tarka1939.mysite;

/**
 * Two projects cannot claim the same GitHub repository -- a delivery has to match exactly one,
 * and {@code ux_project_repo_full_name_lower} enforces it in the database. Raised so that the
 * attempt answers 409 rather than surfacing as a constraint violation the caller cannot read.
 */
public class DuplicateRepoFullNameException extends RuntimeException {

    public DuplicateRepoFullNameException(String message) {
        super(message);
    }
}
