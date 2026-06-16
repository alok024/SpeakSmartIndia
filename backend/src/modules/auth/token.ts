import crypto from 'crypto';

/**
 * Generates a cryptographically secure random token.
 * 32 bytes → 64-char hex string (256 bits of entropy).
 * This is the value sent to the user — NEVER stored directly.
 */
export function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * One-way SHA-256 hash of a raw token.
 * Only the hash is persisted in the database.
 *
 * SHA-256 is appropriate here because:
 * - Tokens are already high-entropy (256 bits), making brute-force infeasible.
 * - We need fast single-lookup performance (bcrypt would be overkill).
 */
export function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}
