import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { env } from '../../core/config/env';
import { db } from '../../core/database/client';
import { authLogger } from '../../infra/logger';
import type { JWTPayload } from '../../core/middleware';
import type { RegisterDTO, LoginDTO } from '../../core/utils/schemas';
import { attributeReferral } from '../growth/referral.service';

// ── Types ─────────────────────────────────────────────────────────

export interface AuthTokens {
  token:        string;
  refreshToken: string;
}

export interface PublicUser {
  id:       string;
  email:    string;
  plan:     string;
  name:     string;
  ai_calls: number;
}

// ── Token generation ──────────────────────────────────────────────

export function generateTokens(
  user: Pick<JWTPayload, 'id' | 'email' | 'plan' | 'name'>
): AuthTokens {
  const jti = crypto.randomUUID();

  const payload: Omit<JWTPayload, 'iat' | 'exp'> = {
    id:    user.id,
    email: user.email,
    plan:  user.plan,
    name:  user.name || '',
    jti,
  };

  const token = jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: '7d',
  } as jwt.SignOptions);

  const refreshToken = jwt.sign(
    { id: user.id, jti: crypto.randomUUID(), type: 'refresh' },
    env.JWT_REFRESH_SECRET,
    { expiresIn: '30d' } as jwt.SignOptions
  );

  return { token, refreshToken };
}

// ── Register ──────────────────────────────────────────────────────

export async function registerUser(
  dto: RegisterDTO
): Promise<{ tokens: AuthTokens; user: PublicUser }> {
  const existing = await db.getUserByEmail(dto.email);
  if (existing) {
    throw Object.assign(new Error('Email already registered'), { statusCode: 409 });
  }

  const password_hash = await bcrypt.hash(dto.password, 12);

  const user = await db.createUser({
    email:         dto.email,
    password_hash,
    plan:          'free',
    name:          dto.name || '',
  });

  if (!user) throw new Error('Failed to create user');

  // Initialise usage + stats rows in parallel
  await Promise.all([
    db.upsertUsage(user.id, 0),
    db.upsertStats(user.id, { streak: 0, sessions: 0, best_score: 0, total_score: 0 }),
  ]);

  authLogger.info('User registered', { userId: user.id, email: user.email });

  // Attribute referral if a ref code was provided at signup (non-fatal)
  if (dto.ref) {
    await attributeReferral(user.id, dto.ref).catch(() => {});
  }

  const tokens = generateTokens(user);
  return {
    tokens,
    user: { id: user.id, email: user.email, plan: user.plan, name: user.name, ai_calls: 0 },
  };
}

// ── Login ─────────────────────────────────────────────────────────

export async function loginUser(
  dto: LoginDTO
): Promise<{ tokens: AuthTokens; user: PublicUser }> {
  const user = await db.getUserByEmail(dto.email);
  if (!user) {
    throw Object.assign(new Error('Invalid email or password'), { statusCode: 401 });
  }

  const valid = await bcrypt.compare(dto.password, user.password_hash);
  if (!valid) {
    throw Object.assign(new Error('Invalid email or password'), { statusCode: 401 });
  }

  const usage = await db.getUsage(user.id);

  authLogger.info('User logged in', { userId: user.id });

  const tokens = generateTokens(user);
  return {
    tokens,
    user: {
      id:       user.id,
      email:    user.email,
      plan:     user.plan,
      name:     user.name,
      ai_calls: usage?.call_count ?? 0,
    },
  };
}

// ── Logout — blacklist current access token ───────────────────────

export async function logoutUser(
  jti:       string,
  userId:    string,
  expiresAt: Date
): Promise<void> {
  await db.blacklistToken({
    token_jti:  jti,
    user_id:    userId,
    expires_at: expiresAt.toISOString(),
  });
  authLogger.info('Token blacklisted on logout', { userId, jti });
}

// ── Refresh access token ──────────────────────────────────────────

export async function refreshAccessToken(refreshToken: string): Promise<AuthTokens> {
  let payload: { id: string; type: string };
  try {
    payload = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET) as {
      id: string; type: string;
    };
  } catch {
    throw Object.assign(new Error('Invalid or expired refresh token'), { statusCode: 401 });
  }

  if (payload.type !== 'refresh') {
    throw Object.assign(new Error('Invalid token type'), { statusCode: 401 });
  }

  const user = await db.getUserById(payload.id);
  if (!user) {
    throw Object.assign(new Error('User not found'), { statusCode: 404 });
  }

  authLogger.info('Tokens refreshed', { userId: user.id });
  return generateTokens(user);
}

// ── Forgot password ───────────────────────────────────────────────

export async function requestPasswordReset(email: string): Promise<string | null> {
  const user = await db.getUserByEmail(email);
  if (!user) return null; // silent — never reveal whether email exists

  const resetToken = crypto.randomBytes(32).toString('hex');
  const expiresAt  = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

  await db.createPasswordReset({ user_id: user.id, token: resetToken, expires_at: expiresAt });

  authLogger.info('Password reset token created', { userId: user.id });
  return resetToken;
}

// ── Confirm password reset ────────────────────────────────────────

export async function confirmPasswordReset(
  token:       string,
  newPassword: string
): Promise<void> {
  const reset = await db.getPasswordReset(token);

  if (!reset || reset.used) {
    throw Object.assign(new Error('Invalid or expired reset token'), { statusCode: 400 });
  }

  if (new Date(reset.expires_at) < new Date()) {
    throw Object.assign(new Error('Reset token has expired'), { statusCode: 400 });
  }

  const password_hash = await bcrypt.hash(newPassword, 12);

  await Promise.all([
    db.updateUser(reset.user_id, { password_hash }),
    db.markPasswordResetUsed(reset.id!),
  ]);

  authLogger.info('Password reset confirmed', { userId: reset.user_id });
}
