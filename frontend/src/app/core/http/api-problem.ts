export interface ApiFieldError {
  field: string;
  message: string;
}

/**
 * Normalized shape for every failed API call, regardless of whether the backend actually sent
 * an RFC 7807 (application/problem+json) body -- see docs/openapi.yaml's ProblemDetail /
 * ValidationProblemDetail schemas. Components should catch this instead of raw HttpErrorResponse.
 */
export interface ApiProblem {
  status: number;
  title: string;
  detail?: string;
  fieldErrors: ApiFieldError[];
  rateLimited: boolean;
}
