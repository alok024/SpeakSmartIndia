'use client';

import { useState } from 'react';
import Link from 'next/link';
import { authApi } from '@/features/auth/api';
import { extractErrorMessage } from '@/lib/api';
import { Button, Input } from '@/components/ui';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const res = await authApi.requestPasswordReset(email);
    setLoading(false);
    if (res.ok) {
      setSuccess('Reset link sent! Check your inbox.');
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
            Speak<span className="text-blue-400">Smart</span>
          </h1>
        </div>

        <div className="bg-[#16181F] border border-white/[0.07] rounded-2xl p-6">
          <h2 className="text-lg font-semibold text-white mb-2">Reset password</h2>
          <p className="text-sm text-[#8B90A0] mb-5">
            Enter your account email and we'll send a reset link.
          </p>

          {success ? (
            <div className="text-sm text-emerald-400 bg-emerald-400/10 rounded-xl px-4 py-3 text-center">
              {success}
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3">
              <Input
                type="email"
                placeholder="Your account email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              {error && (
                <p className="text-sm text-red-400 bg-red-500/10 rounded-xl px-3 py-2">{error}</p>
              )}
              <Button type="submit" className="w-full" loading={loading}>
                Send Reset Link
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
