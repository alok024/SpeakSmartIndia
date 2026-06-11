import { Request, Response } from 'express';
import * as AuthService from './auth.service';
import { authLogger } from '../../infra/logger';
import { env } from '../../core/config/env';

// ── Register ──────────────────────────────────────────────────────

export async function register(req: Request, res: Response): Promise<void> {
  const { tokens, user } = await AuthService.registerUser(req.body);
  res.status(201).json({ token: tokens.token, refreshToken: tokens.refreshToken, user });
}

// ── Login ─────────────────────────────────────────────────────────

export async function login(req: Request, res: Response): Promise<void> {
  const { tokens, user } = await AuthService.loginUser(req.body);
  res.json({ token: tokens.token, refreshToken: tokens.refreshToken, user });
}

// ── Logout ────────────────────────────────────────────────────────

export async function logout(req: Request, res: Response): Promise<void> {
  const user = req.user!;
  if (user.jti && user.exp) {
    await AuthService.logoutUser(user.jti, user.id, new Date(user.exp * 1000));
  }
  res.json({ success: true, message: 'Logged out successfully' });
}

// ── Refresh token ─────────────────────────────────────────────────

export async function refreshToken(req: Request, res: Response): Promise<void> {
  const { refreshToken: rt } = req.body as { refreshToken: string };
  const tokens = await AuthService.refreshAccessToken(rt);
  res.json({ token: tokens.token, refreshToken: tokens.refreshToken });
}

// ── Forgot password ───────────────────────────────────────────────

export async function forgotPassword(req: Request, res: Response): Promise<void> {
  const { email } = req.body as { email: string };
  const resetToken = await AuthService.requestPasswordReset(email);

  if (resetToken) {
    const resetLink = `${env.FRONTEND_URL}/reset-password?token=${resetToken}`;

    // ── Email sending ─────────────────────────────────────────────
    // If RESEND_API_KEY is configured, send a real email.
    // Otherwise, log to console (dev mode).
    if (env.RESEND_API_KEY && env.EMAIL_FROM) {
      try {
        await fetch('https://api.resend.com/emails', {
          method:  'POST',
          headers: {
            'Content-Type':  'application/json',
            'Authorization': `Bearer ${env.RESEND_API_KEY}`,
          },
          body: JSON.stringify({
            from:    env.EMAIL_FROM,
            to:      email,
            subject: 'Reset your SpeakSmart password',
            html: `
              <p>Hi,</p>
              <p>You requested a password reset for your SpeakSmart account.</p>
              <p>
                <a href="${resetLink}" style="
                  display:inline-block;
                  padding:12px 24px;
                  background:#6366f1;
                  color:#fff;
                  border-radius:6px;
                  text-decoration:none;
                  font-weight:600;
                ">Reset Password</a>
              </p>
              <p>This link expires in 1 hour. If you didn't request this, ignore this email.</p>
            `,
          }),
        });
        authLogger.info('Password reset email sent via Resend', { email });
      } catch (err) {
        authLogger.error('Failed to send password reset email', { email, error: err });
        // Don't fail the request — user already got success response
      }
    } else {
      // Development fallback — log the link
      authLogger.info('Password reset link (configure RESEND_API_KEY to send email)', {
        email,
        link: resetLink,
      });
    }
  }

  // Always respond success — never reveal whether email exists
  res.json({
    success: true,
    message: 'If that email is registered, a reset link has been sent.',
  });
}

// ── Reset password ────────────────────────────────────────────────

export async function resetPassword(req: Request, res: Response): Promise<void> {
  const { token, new_password } = req.body as { token: string; new_password: string };
  await AuthService.confirmPasswordReset(token, new_password);
  res.json({ success: true, message: 'Password updated. Please log in.' });
}
