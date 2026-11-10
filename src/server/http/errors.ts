import "server-only";

/** Base class for errors that map to a specific HTTP status in `withErrors`. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** 400: the request is well-formed JSON but not acceptable. */
export class ValidationError extends HttpError {
  constructor(message: string, code = "VALIDATION_ERROR", details?: unknown) {
    super(400, code, message, details);
  }
}

/** 403: wrong role, missing passcode, or a missing human approval. */
export class PolicyError extends HttpError {
  constructor(message: string, code = "FORBIDDEN", details?: unknown) {
    super(403, code, message, details);
  }
}

/** 404 */
export class NotFoundError extends HttpError {
  constructor(what: string, code = "NOT_FOUND") {
    super(404, code, `${what} not found`);
  }
}

/** 409: the resource is not in a state that allows the request. */
export class ConflictError extends HttpError {
  constructor(message: string, code = "CONFLICT", details?: unknown) {
    super(409, code, message, details);
  }
}
