'use client';

import { useState , Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useLogin } from '@/hooks/queries';
import { extractErrorMessage } from '@/lib/api';

// ── Design tokens ──────────────────────────────────────────────────
const T = {
  bg:        '#0C0A10',
  surface:   '#141118',
  surface2:  '#1E1A26',
  border:    'rgba(255,255,255,0.07)',
  border2:   'rgba(255,255,255,0.13)',
  orange:    '#F97316',
  orangeDim: 'rgba(249,115,22,0.12)',
  violetDim: 'rgba(139,92,246,0.12)',
  emerald:   '#10B981',
  text1:     '#F5F3FF',
  text2:     '#9490A8',
  text3:     '#5C5770',
};

function LoginPageInner() {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');

  const login  = useLogin();
  const router = useRouter();
  const params = useSearchParams();
  const redirectTo = params.get('next') || '/dashboard';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const res = await login.mutateAsync({ email, password });
    if (res.ok) {
      router.push(redirectTo);
    } else {
      setError(extractErrorMessage(res.error));
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{ background: T.bg }}
    >
      <div
        className="w-full max-w-3xl flex rounded-2xl overflow-hidden border"
        style={{ borderColor: T.border2 }}
      >
        {/* ── Left panel — brand & trust ── */}
        <div
          className="hidden md:flex flex-1 flex-col justify-center p-8 relative overflow-hidden border-r"
          style={{ background: T.bg, borderColor: T.border }}
        >
          {/* Ambient glow blobs */}
          <div
            className="absolute pointer-events-none"
            style={{
              top: '-60px', left: '-60px',
              width: '200px', height: '200px',
              borderRadius: '50%',
              background: 'rgba(249,115,22,0.12)',
              filter: 'blur(40px)',
            }}
          />
          <div
            className="absolute pointer-events-none"
            style={{
              bottom: '-40px', right: '-40px',
              width: '160px', height: '160px',
              borderRadius: '50%',
              background: 'rgba(139,92,246,0.12)',
              filter: 'blur(40px)',
            }}
          />

          {/* Brand mark */}
          <div className="flex items-center gap-3 mb-6 relative z-10">
            <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
              <circle cx="18" cy="18" r="17" fill="rgba(249,115,22,0.1)" stroke="rgba(249,115,22,0.3)" strokeWidth="0.5"/>
              <rect x="13" y="8" width="10" height="14" rx="5" fill="#F97316"/>
              <path d="M10 20C10 24 13.6 27 18 27S26 24 26 20" stroke="#F97316" strokeWidth="1.8" strokeLinecap="round"/>
              <line x1="18" y1="27" x2="18" y2="30" stroke="#F97316" strokeWidth="1.8" strokeLinecap="round"/>
              <line x1="14" y1="30" x2="22" y2="30" stroke="#F97316" strokeWidth="1.8" strokeLinecap="round"/>
            </svg>
            <span
              className="text-lg font-bold relative z-10"
              style={{ color: T.text1, letterSpacing: '-0.03em' }}
            >
              Speak<span style={{ color: T.orange }}>Smart</span>
            </span>
          </div>

          {/* Tagline */}
          <h2
            className="text-2xl font-bold leading-snug mb-3 relative z-10"
            style={{ color: T.text1, letterSpacing: '-0.03em' }}
          >
            Crack your interview.<br />
            <span style={{ color: T.orange }}>Know exactly</span> what to fix.
          </h2>
          <p className="text-sm leading-relaxed mb-6 relative z-10" style={{ color: T.text2 }}>
            AI interview coach built for Indian job seekers — Bank PO, UPSC, Software Dev, and more.
            Real feedback, in minutes.
          </p>

          {/* Trust pills */}
          <div className="flex flex-wrap gap-2 relative z-10">
            {[
              { dot: true, label: '10,000+ users' },
              { dot: false, label: '✦ Bank PO · UPSC · Tech' },
              { dot: false, label: 'Free to start' },
            ].map((pill) => (
              <span
                key={pill.label}
                className="flex items-center gap-1.5 text-[10px] px-2.5 py-1 rounded-full border"
                style={{
                  background: T.surface2,
                  borderColor: T.border2,
                  color: T.text2,
                }}
              >
                {pill.dot && (
                  <span
                    className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                    style={{ background: T.emerald }}
                  />
                )}
                {pill.label}
              </span>
            ))}
          </div>
        </div>

        {/* ── Right panel — sign in form ── */}
        <div
          className="w-full md:w-[260px] flex-shrink-0 flex flex-col justify-center p-7"
          style={{ background: T.surface }}
        >
          {/* Mobile-only brand */}
          <div className="flex md:hidden items-center gap-2 mb-6">
            <svg width="28" height="28" viewBox="0 0 36 36" fill="none">
              <circle cx="18" cy="18" r="17" fill="rgba(249,115,22,0.1)" stroke="rgba(249,115,22,0.3)" strokeWidth="0.5"/>
              <rect x="13" y="8" width="10" height="14" rx="5" fill="#F97316"/>
              <path d="M10 20C10 24 13.6 27 18 27S26 24 26 20" stroke="#F97316" strokeWidth="1.8" strokeLinecap="round"/>
              <line x1="18" y1="27" x2="18" y2="30" stroke="#F97316" strokeWidth="1.8" strokeLinecap="round"/>
              <line x1="14" y1="30" x2="22" y2="30" stroke="#F97316" strokeWidth="1.8" strokeLinecap="round"/>
            </svg>
            <span className="text-sm font-bold" style={{ color: T.text1 }}>
              Speak<span style={{ color: T.orange }}>Smart</span>
            </span>
          </div>

          <h2
            className="text-base font-bold mb-5"
            style={{ color: T.text1, letterSpacing: '-0.02em' }}
          >
            Sign in
          </h2>

          <form onSubmit={handleSubmit} className="space-y-2">
            {/* Email field */}
            <input
              type="email"
              placeholder="Email address"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full text-xs px-3 py-2.5 rounded-[10px] outline-none transition-colors"
              style={{
                background: T.surface2,
                border: `0.5px solid ${T.border2}`,
                color: T.text2,
              }}
              onFocus={e => (e.target.style.borderColor = T.orange)}
              onBlur={e  => (e.target.style.borderColor = T.border2)}
            />

            {/* Password field */}
            <input
              type="password"
              placeholder="Password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full text-xs px-3 py-2.5 rounded-[10px] outline-none transition-colors"
              style={{
                background: T.surface2,
                border: `0.5px solid ${T.border2}`,
                color: T.text2,
              }}
              onFocus={e => (e.target.style.borderColor = T.orange)}
              onBlur={e  => (e.target.style.borderColor = T.border2)}
            />

            {error && (
              <p className="text-xs rounded-xl px-3 py-2" style={{ color: '#EF4444', background: 'rgba(239,68,68,0.1)' }}>
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={login.isPending}
              className="w-full text-sm font-bold text-white py-2.5 rounded-[10px] border-none transition-opacity disabled:opacity-60"
              style={{
                background: `linear-gradient(135deg, ${T.orange}, #F59E0B)`,
                marginTop: '6px',
                letterSpacing: '0.01em',
              }}
            >
              {login.isPending ? 'Signing in…' : 'Sign In →'}
            </button>
          </form>

          <button
            onClick={() => router.push('/forgot-password')}
            className="mt-3 text-[11px] w-full text-center transition-colors"
            style={{ color: T.text3 }}
            onMouseEnter={e => (e.currentTarget.style.color = T.text2)}
            onMouseLeave={e => (e.currentTarget.style.color = T.text3)}
          >
            Forgot password?
          </button>

          <p className="text-center text-[11px] mt-4" style={{ color: T.text3 }}>
            No account?{' '}
            <Link
              href="/register"
              className="font-medium transition-colors"
              style={{ color: T.orange }}
            >
              Create one free
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div />}>
      <LoginPageInner />
    </Suspense>
  );
}
