'use client';

import { useState } from 'react';
import Link from 'next/link';
import { authApi } from '@/features/auth/api';
import { extractErrorMessage } from '@/lib/api';
import { Button, Input } from '@/components/ui';

export default function ForgotPasswordPage() {
  const [email,   setEmail]   = useState('');
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const [success, setSuccess] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const res = await authApi.requestPasswordReset(email);
    setLoading(false);
    if (res.ok) setSuccess('Reset link sent! Check your inbox.');
    else setError(extractErrorMessage(res.error));
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'var(--bg)' }}>
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-4xl mb-3">🎙️</div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-1)' }}>
            Speak<span style={{ color: 'var(--accent)' }}>Smart</span>
          </h1>
        </div>

        <div className="rounded-2xl p-6" style={{ background: 'var(--surface)', border: '1px solid var(--border)', boxShadow: 'var(--card-shadow)' }}>
          <h2 className="text-lg font-semibold mb-2" style={{ color: 'var(--text-1)' }}>Reset password</h2>
          <p className="text-sm mb-5" style={{ color: 'var(--text-3)' }}>
            Enter your account email and we'll send a reset link.
          </p>

          {success ? (
            <div className="text-sm rounded-xl px-4 py-3 text-center" style={{ color: 'var(--success)', background: 'var(--success-dim)', border: '1px solid var(--success-border)' }}>
              {success}
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3">
              <Input
                type="email" placeholder="Your account email" autoComplete="email"
                value={email} onChange={(e) => setEmail(e.target.value)} required
              />
              {error && (
                <p className="text-sm rounded-xl px-3 py-2" style={{ color: 'var(--error)', background: 'var(--error-dim)', border: '1px solid var(--error-border)' }}>
                  {error}
                </p>
              )}
              <Button type="submit" className="w-full" loading={loading}>Send Reset Link</Button>
            </form>
          )}
        </div>

        <p className="text-center text-sm mt-4">
          <Link href="/login" style={{ color: 'var(--accent)' }}>← Back to sign in</Link>
        </p>
      </div>
    </div>
  );
}
