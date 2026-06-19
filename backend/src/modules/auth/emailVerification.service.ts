import { db } from '../../core/database/client';
import { generateToken, hashToken } from './token';
import { sendVerificationEmail } from './email.service';
import { authLogger } from '../../infra/logger';

// Constants

const TOKEN_EXPIRY_HOURS = 24;
const RESEND_LIMIT       = 3;
const RESEND_WINDOW_MS   = 60 * 60 * 1000; // 1 hour

// Custom errors

/**
 * Thrown when a user has hit the resend rate limit (3 emails / hour).
 * Caught in the route/controller layer to return HTTP 429.
 */
// RateLimitError is now defined in core/utils/errors and re-exported here for backwards compat
export { RateLimitError } from '../../core/utils/errors';
import { RateLimitError } from '../../core/utils/errors';

// Result type

export interface VerifyTokenResult {
  success: boolean;
  message: string;
}

// Service functions

/**
 * createVerificationToken
 * 1. Invalidate all previous unused tokens for this user
 * 2. Generate a new 256-bit token, store its SHA-256 hash
 * 3. Record the send event (used for rate-limiting)
 * 4. Deliver the email with the raw token embedded in the link
 *
 * Called from both the register flow and the resend flow.
 * Throws if any DB write or the email send fails — callers that must
 * not fail the parent request (e.g. signup) should catch and log.
 */
export async function createVerificationToken(userId: string, email: string): Promise<void> {
  // Step 1 — invalidate previous tokens so only one link is ever valid
  await db.invalidateEmailVerificationTokens(userId);

  // Step 2 — generate token, hash it, set 24h TTL
  const rawToken  = generateToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_HOURS * 60 * 60 * 1000).toISOString();

  await db.createEmailVerificationToken({
    user_id:    userId,
    token_hash: tokenHash,
    expires_at: expiresAt,
  });

  // Step 3 — record the send for rate-limit tracking
  await db.recordEmailVerificationSend(userId);

  // Step 4 — deliver email (throws on delivery failure)
  await sendVerificationEmail(email, rawToken);
}

/**
 * verifyEmailToken
 * 1. Hash the incoming raw token
 * 2. Look it up in the DB — NEVER query by raw value
 * 3. Validate: exists, not used, not expired
 * 4. Mark token used + set user.email_verified = true
 *
 * All failure paths return the same generic message to avoid
 * leaking which tokens exist / are expired / are reused.
 */
export async function verifyEmailToken(rawToken: string): Promise<VerifyTokenResult> {
  const GENERIC_FAIL = 'Invalid or expired verification link.';
  const tokenHash = hashToken(rawToken);

  const token = await db.getEmailVerificationTokenByHash(tokenHash);

  if (!token) {
    return { success: false, message: GENERIC_FAIL };
  }

  if (token.used) {
    return { success: false, message: GENERIC_FAIL };
  }

  if (new Date(token.expires_at) < new Date()) {
    return { success: false, message: GENERIC_FAIL };
  }

  // Mark token as used first — the `used=eq.false` guard means only one
  // concurrent request can win this; the loser gets `false` back.
  const claimed = await db.markEmailVerificationTokenUsed(token.id!);
  if (!claimed) {
    return { success: false, message: GENERIC_FAIL };
  }

  await db.updateUser(token.user_id, { email_verified: true });

  authLogger.info('Email verified', { userId: token.user_id });

  return { success: true, message: 'Email verified successfully. You can now log in.' };
}

/**
 * resendVerification
 * Always resolves silently for unknown / already-verified emails —
 * never reveals account existence or verification status.
 * Throws RateLimitError (caught by the controller) to return 429
 * without leaking whether the account exists.
 */
export async function resendVerification(email: string): Promise<void> {
  const normalised = email.toLowerCase().trim();

  const user = await db.getUserByEmail(normalised);

  // Unknown email or already verified — silently succeed (no enumeration)
  if (!user) return;
  if (user.email_verified) return;

  // Rate-limit check: has the user received >= 3 emails in the last hour?
  const windowStart = new Date(Date.now() - RESEND_WINDOW_MS).toISOString();
  const recentCount = await db.countRecentEmailVerificationSends(user.id, windowStart);

  if (recentCount >= RESEND_LIMIT) {
    throw new RateLimitError();
  }

  // Issue new token + send email
  await createVerificationToken(user.id, user.email);
}
