// Centralized error types
//
// All services must throw AppError (or a subclass) instead of plain
// `new Error(...)`.  The global errorHandler in middleware.ts already reads
// `.statusCode` and `.code`, so these throw straight through to the client
// with the right HTTP status and machine-readable code — no per-controller
// catch needed.
//
// Usage:
//   throw new AppError(404, 'not_found', 'User not found');
//   throw new AppError(503, 'ai_unavailable', 'All AI providers are down');
//
// RateLimitError is kept here alongside AppError so every module imports
// from one place instead of from emailVerification.service.

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
    // Maintain proper prototype chain in transpiled ES5 output
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// Convenience subclasses

/** 400 */
export class BadRequestError extends AppError {
  constructor(code: string, message: string) {
    super(400, code, message);
    this.name = 'BadRequestError';
  }
}

/** 401 */
export class UnauthorizedError extends AppError {
  constructor(code = 'unauthorized', message = 'Unauthorized') {
    super(401, code, message);
    this.name = 'UnauthorizedError';
  }
}

/** 403 */
export class ForbiddenError extends AppError {
  constructor(code = 'forbidden', message = 'Forbidden') {
    super(403, code, message);
    this.name = 'ForbiddenError';
  }
}

/** 404 */
export class NotFoundError extends AppError {
  constructor(code = 'not_found', message: string) {
    super(404, code, message);
    this.name = 'NotFoundError';
  }
}

/** 429 */
export class RateLimitError extends AppError {
  constructor(code = 'too_many_requests', message = 'Too many requests. Please slow down.') {
    super(429, code, message);
    this.name = 'RateLimitError';
  }
}

/** 503 */
export class ServiceUnavailableError extends AppError {
  constructor(code = 'service_unavailable', message: string) {
    super(503, code, message);
    this.name = 'ServiceUnavailableError';
  }
}

// AI-specific errors

/**
 * 503 — thrown when all AI providers are unavailable or circuit-broken.
 * Carries retryAfterSeconds so the controller can set the Retry-After header
 * without parsing arbitrary error shapes.
 */
export class AIUnavailableError extends AppError {
  constructor(
    public readonly retryAfterSeconds: number = 30,
    message = 'AI service temporarily unavailable. Please try again in a moment.',
  ) {
    super(503, 'ai_unavailable', message);
    this.name = 'AIUnavailableError';
  }
}
