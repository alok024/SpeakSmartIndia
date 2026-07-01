import { Request, Response, CookieOptions } from 'express';
import { IS_PROD } from '../../core/config/env';
import { ACCESS_TOKEN_TTL_MS } from './auth.service';

// httpOnly auth cookie names
// These are the httpOnly auth cookies. JS on the
// frontend never sees these values — XSS can no longer steal sessions.

export const ACCESS_COOKIE  = 'vachix_at';
export const REFRESH_COOKIE = 'vachix_rt';

// matches ACCESS_TOKEN_EXPIRES_IN ('30m') in auth.service.ts —
// imported (not redeclared) so the cookie lifetime can never drift out of
// sync with the JWT's own expiry again.
const ACCESS_TTL_MS  = ACCESS_TOKEN_TTL_MS;
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

// Mobile clients (Flutter, native) don't keep a cookie jar the way a
// browser does, so the httpOnly-cookie flow that protects web sessions
// from XSS doesn't apply to them — they need the raw tokens to store in
// platform secure storage and replay as `Authorization: Bearer`.
// Cookies are still set on every response regardless (harmless if the
// client ignores them); this header just opts a request into *also*
// getting the tokens back in the JSON body. The header is checked, not
// guessed from User-Agent, so this is an explicit per-request choice
// made by the calling client, not implicit platform detection.
export const CLIENT_PLATFORM_HEADER = 'x-vachix-client';

export function wantsTokenBody(req: Request): boolean {
  return req.headers[CLIENT_PLATFORM_HEADER] === 'mobile';
}

export function tokenBody(tokens: { token: string; refreshToken: string }) {
  return {
    access_token:  tokens.token,
    refresh_token: tokens.refreshToken,
    token_type:    'Bearer',
    expires_in:    ACCESS_TTL_MS / 1000,
  };
}
