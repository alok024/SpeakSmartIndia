'use client';

import { useState , Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useRegister } from '@/hooks/queries';
import { extractErrorMessage } from '@/lib/api';
import { Button, Input } from '@/components/ui';

function RegisterPageInner() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const register = useRegister();
  const router = useRouter();
  const params = useSearchParams();
  const ref = params.get('ref') ?? undefined;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSuccess('');
    const res = await register.mutateAsync({ name, email, password, ref });
    if (res.ok) {
      if (res.data.email_sent) {
        setSuccess('Account created! Check your inbox to verify your email, then sign in.');
      } else {
        router.push('/dashboard');
      }
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
          <p className="text-sm text-[#8B90A0] mt-2">
            AI interview coach · Built for India
          </p>
        </div>

        <div className="bg-[#16181F] border border-white/[0.07] rounded-2xl p-6">
          <h2 className="text-lg font-semibold text-white mb-5">Create free account</h2>

          {success ? (
            <div className="text-sm text-emerald-400 bg-emerald-400/10 rounded-xl px-4 py-3 text-center">
              {success}
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3">
              <Input
                type="text"
                placeholder="Your name"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
              <Input
                type="email"
                placeholder="Email address"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              <Input
                type="password"
                placeholder="Password (min 6 chars)"
                autoComplete="new-password"
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />

              {error && (
                <p className="text-sm text-red-400 bg-red-500/10 rounded-xl px-3 py-2">{error}</p>
              )}

              <Button type="submit" className="w-full mt-1" loading={register.isPending}>
                Create Free Account
              </Button>

              <p className="text-[10px] text-[#555A6A] text-center">
                Free · AI sessions included · No credit card
              </p>
            </form>
          )}
        </div>

        <p className="text-center text-sm text-[#8B90A0] mt-4">
          Already have an account?{' '}
          <Link href="/login" className="text-blue-400 hover:text-blue-300 font-medium">
            Sign in →
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={<div />}>
      <RegisterPageInner />
    </Suspense>
  );
}
