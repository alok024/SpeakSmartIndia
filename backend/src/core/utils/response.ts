import { Response } from 'express';

// ════════════════════════════════════════════════════════════════════════════
// Unified API response envelope
//
// Success: { success: true, data: {...} }
// Error:   { success: false, error: { code: string, message: string, details?: unknown, request_id?: string } }
//
// Every controller should use these helpers so the frontend can rely on a
// single, predictable contract for every endpoint.
//
// L4: every error envelope includes `request_id` (when available) — the same
// ID attached as the X-Request-Id response header and logged with every
// server-side log line for this request (see app.ts's request-id middleware).
// The frontend surfaces this as a "Error ref: <id>" support reference so a
// user's bug report can be correlated with backend logs/Sentry traces.
// ════════════════════════════════════════════════════════════════════════════

/** Reads the per-request correlation ID set by app.ts's request-id middleware. */
function requestIdOf(res: Response): string | undefined {
  return res.req?.requestId;
}

function errorBody(
  code: string,
  message: string,
  requestId?: string,
  details?: unknown,
) {
  return {
    success: false,
    error: {
      code,
      message,
      ...(details !== undefined ? { details } : {}),
      ...(requestId !== undefined ? { request_id: requestId } : {}),
    },
  };
}

// ─── Success ──────────────────────────────────────────────────────────────────

export function ok(res: Response, data: object = {}): Response {
  return res.status(200).json({ success: true, data });
}

export function created(res: Response, data: object = {}): Response {
  return res.status(201).json({ success: true, data });
}

// ─── Client errors ────────────────────────────────────────────────────────────

export function badRequest(res: Response, message: string, code = 'bad_request', details?: unknown): Response {
  return res.status(400).json(errorBody(code, message, requestIdOf(res), details));
}

export function unauthorized(res: Response, message: string, code = 'unauthorized'): Response {
  return res.status(401).json(errorBody(code, message, requestIdOf(res)));
}

export function forbidden(res: Response, message: string, code = 'forbidden'): Response {
  return res.status(403).json(errorBody(code, message, requestIdOf(res)));
}

export function notFound(res: Response, message: string, code = 'not_found'): Response {
  return res.status(404).json(errorBody(code, message, requestIdOf(res)));
}

export function tooManyRequests(res: Response, message: string, code = 'too_many_requests'): Response {
  return res.status(429).json(errorBody(code, message, requestIdOf(res)));
}

// ─── Server errors ────────────────────────────────────────────────────────────

export function serverError(
  res: Response,
  message = 'An unexpected error occurred. Please try again.',
  code = 'internal_error'
): Response {
  return res.status(500).json(errorBody(code, message, requestIdOf(res)));
}

// ─── Generic status-based error (for codes/statuses not covered above) ────────

export function fail(res: Response, status: number, code: string, message: string, details?: unknown): Response {
  return res.status(status).json(errorBody(code, message, requestIdOf(res), details));
}
