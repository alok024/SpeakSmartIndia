'use client';

/**
 * app/(auth)/reset-password/page.tsx
 *
 * Route: /reset-password?token=<token>
 *
 * Lands here from the link emailed by `POST /password-reset/request`
 * (see `backend/src/modules/auth/auth.controller.ts` -> forgotPassword,
 * which builds `${FRONTEND_URL}/reset-password?token=...`).
 *
 * Collects a new password and calls `POST /password-reset/confirm`.
 * Fixes Critical Bug #2 — this page previously did not exist, so the
 * emailed reset link 404'd and the reset flow could never be completed.
 */

import { useState , Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { authApi } from '@/features/auth/api';
import { extractErrorMessage } from '@/lib/api';
import { Button, Input } from '@/components/ui';

function ResetPasswordPageInner() {
  const params = useSearchParams();
  const token = params.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!token) {
      setError('This reset link is missing its token. Please request a new one.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    const res = await authApi.confirmPasswordReset(token, password);
    setLoading(false);

    if (res.ok) {
      setSuccess(true);
    } else {
      setError(extractErrorMessage(res.error));
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0E0F14] p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-4xl mb-3">🎙️</div>
          <h1 className="text-2xl font-bold text-white">
            Vachix
          </h1>
        </div>

        <div className="bg-[#16181F] border border-white/[0.07] rounded-2xl p-6">
          <h2 className="text-lg font-semibold text-white mb-2">Set a new password</h2>

          {success ? (
            <div className="space-y-4">
              <div className="text-sm text-emerald-400 bg-emerald-400/10 rounded-xl px-4 py-3 text-center">
                Password updated! You can now sign in with your new password.
              </div>
              <Link href="/login">
                <Button type="button" className="w-full">
                  Go to sign in
                </Button>
              </Link>
            </div>
          ) : !token ? (
            <div className="space-y-4">
              <p className="text-sm text-red-400 bg-red-500/10 rounded-xl px-3 py-2">
                This reset link is invalid or missing its token.
              </p>
              <Link href="/forgot-password" className="text-sm text-blue-400 hover:text-blue-300">
                ← Request a new reset link
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3">
              <p className="text-sm text-[#8B90A0] mb-2">
                Choose a new password for your account.
              </p>
              <Input
                type="password"
                placeholder="New password (min 8 chars)"
                autoComplete="new-password"
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <Input
                type="password"
                placeholder="Confirm new password"
                autoComplete="new-password"
                minLength={8}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />
              {error && (
                <p className="text-sm text-red-400 bg-red-500/10 rounded-xl px-3 py-2">{error}</p>
              )}
              <Button type="submit" className="w-full" loading={loading}>
                Update Password
              </Button>
            </form>
          )}
        </div>

        <p className="text-center text-sm text-[#8B90A0] mt-4">
          <Link href="/login" className="text-blue-400 hover:text-blue-300">
            ← Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div />}>
      <ResetPasswordPageInner />
    </Suspense>
  );
}
