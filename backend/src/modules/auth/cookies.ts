import { Response, CookieOptions } from 'express';
import { IS_PROD } from '../../core/config/env';

// ── httpOnly auth cookie names ─────────────────────────────────────
// These replace the old localStorage-based token storage. JS on the
// frontend never sees these values — XSS can no longer steal sessions.

export const ACCESS_COOKIE  = 'ss_at';
export const REFRESH_COOKIE = 'ss_rt';

const ACCESS_TTL_MS  = 7  * 24 * 60 * 60 * 1000; // matches JWT_SECRET token expiry (7d)
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000; // matches JWT_REFRESH_SECRET token expiry (30d)

// Requests reach the backend via the Next.js rewrite proxy (/api/* ->
// backend), so from the browser's perspective these cookies are
// first-party/same-site — 'lax' is sufficient and safer than 'none'.
const baseOpts: CookieOptions = {
  httpOnly: true,
  secure:   IS_PROD,
  sameSite: 'lax',
  path:     '/',
};

// Both cookies share path '/': middleware.ts performs silent refreshes
// from arbitrary page requests (e.g. /dashboard), so the refresh cookie
// must be sent on those requests too — a path scoped to /api/refresh-token
// would never reach the middleware's request.
const refreshOpts: CookieOptions = baseOpts;

export function setAccessCookie(res: Response, token: string): void {
  res.cookie(ACCESS_COOKIE, token, { ...baseOpts, maxAge: ACCESS_TTL_MS });
}

export function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE, token, { ...refreshOpts, maxAge: REFRESH_TTL_MS });
}

export function setAuthCookies(
  res: Response,
  tokens: { token: string; refreshToken: string }
): void {
  setAccessCookie(res, tokens.token);
  setRefreshCookie(res, tokens.refreshToken);
}

export function clearAuthCookies(res: Response): void {
  res.clearCookie(ACCESS_COOKIE, baseOpts);
  res.clearCookie(REFRESH_COOKIE, refreshOpts);
}
