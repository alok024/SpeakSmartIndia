'use client';

/**
 * app/(auth)/login/page.tsx
 *
 * Premium login page — matches the landing page's dark aesthetic with:
 * - Animated ambient glow orbs
 * - Scroll-reveal fade-in on mount
 * - Floating label inputs with orange focus glow
 * - Glassmorphism card effect
 * - Full mobile + desktop responsive layout
 * - Left panel: brand story with animated trust stats
 * - Right panel: compact, polished sign-in form
 */

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useLogin } from '@/hooks/queries';
import { extractErrorMessage } from '@/lib/api';

// ── Design tokens (match landing.css palette) ──────────────────
const T = {
  bg:         '#080810',
  bg2:        '#0e0e1a',
  bg3:        '#13131f',
  border:     'rgba(255,255,255,0.06)',
  border2:    'rgba(255,255,255,0.11)',
  border3:    'rgba(255,255,255,0.22)',
  orange:     '#F97316',
  orangeDim:  'rgba(249,115,22,0.10)',
  orangeGlow: 'rgba(249,115,22,0.28)',
  violet:     '#9b7fff',
  violetDim:  'rgba(155,127,255,0.08)',
  emerald:    '#4dd9ac',
  emeraldDim: 'rgba(77,217,172,0.08)',
  gold:       '#e2c97e',
  text1:      '#f0eeff',
  text2:      '#bfbbd6',
  text3:      '#7d789c',
};

// ── Trust stats shown on left panel ───────────────────────────
const STATS = [
  { value: '10,000+', label: 'Active learners', color: T.emerald },
  { value: '4.8★',   label: 'Average rating',  color: T.gold },
  { value: '92%',    label: 'Interview success rate', color: T.violet },
];

// ── Micro feature pills ────────────────────────────────────────
const FEATURES = [
  'Bank PO · UPSC · SSC',
  'Real-time AI feedback',
  'Free to start',
  'Hindi + English',
];

// ── Inline keyframe styles (no extra CSS file needed) ─────────
const KEYFRAMES = `
@keyframes ss-fade-up {
  from { opacity: 0; transform: translateY(18px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes ss-orb-pulse {
  0%, 100% { transform: scale(1);   opacity: 0.6; }
  50%       { transform: scale(1.15); opacity: 1;   }
}
@keyframes ss-glow-ring {
  0%, 100% { box-shadow: 0 0 0 0 rgba(249,115,22,0.0); }
  50%       { box-shadow: 0 0 0 6px rgba(249,115,22,0.15); }
}
@keyframes ss-shimmer {
  0%   { background-position: -200% center; }
  100% { background-position:  200% center; }
}
`;

function LoginPageInner() {
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState('');
  const [mounted,  setMounted]  = useState(false);
  const [emailFocus,    setEmailFocus]    = useState(false);
  const [passwordFocus, setPasswordFocus] = useState(false);

  const login  = useLogin();
  const router = useRouter();
  const params = useSearchParams();
  const redirectTo = params.get('next') || '/dashboard';

  useEffect(() => {
    // tiny delay so CSS transition fires on mount
    const t = setTimeout(() => setMounted(true), 30);
    return () => clearTimeout(t);
  }, []);

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
    <>
      <style>{KEYFRAMES}</style>

      {/* ── Full-screen backdrop ─────────────────────────── */}
      <div
        style={{
          minHeight: '100svh',
          background: T.bg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '16px',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Ambient background orbs */}
        <div style={{
          position: 'absolute', top: '-120px', left: '-100px',
          width: '420px', height: '420px', borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(249,115,22,0.08) 0%, transparent 70%)',
          filter: 'blur(60px)',
          animation: 'ss-orb-pulse 8s ease-in-out infinite',
          pointerEvents: 'none',
        }} />
        <div style={{
          position: 'absolute', bottom: '-80px', right: '-80px',
          width: '340px', height: '340px', borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(155,127,255,0.07) 0%, transparent 70%)',
          filter: 'blur(50px)',
          animation: 'ss-orb-pulse 11s ease-in-out infinite reverse',
          pointerEvents: 'none',
        }} />
        <div style={{
          position: 'absolute', top: '40%', left: '30%',
          width: '200px', height: '200px', borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(77,217,172,0.04) 0%, transparent 70%)',
          filter: 'blur(40px)',
          animation: 'ss-orb-pulse 14s ease-in-out infinite',
          pointerEvents: 'none',
        }} />

        {/* ── Main card ──────────────────────────────────── */}
        <div
          style={{
            width: '100%',
            maxWidth: '820px',
            display: 'flex',
            borderRadius: '20px',
            overflow: 'hidden',
            border: `1px solid ${T.border2}`,
            background: T.bg2,
            boxShadow: '0 24px 80px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.04)',
            opacity: mounted ? 1 : 0,
            transform: mounted ? 'translateY(0)' : 'translateY(20px)',
            transition: 'opacity 0.55s cubic-bezier(0.16,1,0.3,1), transform 0.55s cubic-bezier(0.16,1,0.3,1)',
          }}
        >

          {/* ══ LEFT PANEL — brand story ══════════════════ */}
          <div
            style={{
              display: 'none',
              flex: 1,
              flexDirection: 'column',
              justifyContent: 'center',
              padding: '48px 40px',
              position: 'relative',
              overflow: 'hidden',
              background: `linear-gradient(135deg, ${T.bg} 0%, ${T.bg3} 100%)`,
              borderRight: `1px solid ${T.border}`,
            }}
            className="ss-left-panel"
          >
            {/* Inner glow top-left */}
            <div style={{
              position: 'absolute', top: '-40px', left: '-40px',
              width: '180px', height: '180px', borderRadius: '50%',
              background: T.orangeDim, filter: 'blur(50px)',
              pointerEvents: 'none',
            }} />
            {/* Inner glow bottom-right */}
            <div style={{
              position: 'absolute', bottom: '-30px', right: '-30px',
              width: '140px', height: '140px', borderRadius: '50%',
              background: T.violetDim, filter: 'blur(40px)',
              pointerEvents: 'none',
            }} />

            {/* Brand mark */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: '10px',
              marginBottom: '32px', position: 'relative', zIndex: 1,
              animation: 'ss-fade-up 0.6s cubic-bezier(0.16,1,0.3,1) 0.1s both',
            }}>
              <div style={{
                width: '42px', height: '42px', borderRadius: '12px',
                background: T.orangeDim,
                border: `1px solid ${T.orangeGlow}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                animation: 'ss-glow-ring 3s ease-in-out infinite',
              }}>
                <svg width="22" height="22" viewBox="0 0 36 36" fill="none">
                  <rect x="13" y="8" width="10" height="14" rx="5" fill={T.orange}/>
                  <path d="M10 20C10 24 13.6 27 18 27S26 24 26 20" stroke={T.orange} strokeWidth="2" strokeLinecap="round"/>
                  <line x1="18" y1="27" x2="18" y2="30" stroke={T.orange} strokeWidth="2" strokeLinecap="round"/>
                  <line x1="14" y1="30" x2="22" y2="30" stroke={T.orange} strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </div>
              <span style={{ color: T.text1, fontWeight: 700, fontSize: '18px', letterSpacing: '-0.03em' }}>
                Speak<span style={{ color: T.orange }}>Smart</span>
                <span style={{ color: T.text3, fontWeight: 400, fontSize: '12px', marginLeft: '6px' }}>India</span>
              </span>
            </div>

            {/* Hero headline */}
            <div style={{
              position: 'relative', zIndex: 1,
              animation: 'ss-fade-up 0.6s cubic-bezier(0.16,1,0.3,1) 0.18s both',
            }}>
              <h1 style={{
                color: T.text1, fontSize: '28px', fontWeight: 700,
                lineHeight: 1.25, letterSpacing: '-0.04em',
                margin: '0 0 12px',
              }}>
                Crack your interview.<br />
                <span style={{
                  background: `linear-gradient(90deg, ${T.orange}, ${T.gold}, ${T.orange})`,
                  backgroundSize: '200% auto',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                  animation: 'ss-shimmer 3.5s linear infinite',
                }}>Know exactly</span> what to fix.
              </h1>
              <p style={{
                color: T.text2, fontSize: '13px', lineHeight: 1.65,
                margin: '0 0 28px', maxWidth: '320px',
              }}>
                AI interview coach built for Indian job seekers — Bank PO, UPSC, Software Dev, and more. Real feedback in minutes.
              </p>
            </div>

            {/* Feature pills */}
            <div style={{
              display: 'flex', flexWrap: 'wrap', gap: '8px',
              marginBottom: '32px', position: 'relative', zIndex: 1,
              animation: 'ss-fade-up 0.6s cubic-bezier(0.16,1,0.3,1) 0.26s both',
            }}>
              {FEATURES.map((f) => (
                <span key={f} style={{
                  fontSize: '11px', color: T.text2,
                  padding: '5px 12px', borderRadius: '100px',
                  background: T.bg3, border: `1px solid ${T.border2}`,
                  letterSpacing: '0.01em',
                }}>
                  {f}
                </span>
              ))}
            </div>

            {/* Stats row */}
            <div style={{
              display: 'flex', gap: '0', position: 'relative', zIndex: 1,
              animation: 'ss-fade-up 0.6s cubic-bezier(0.16,1,0.3,1) 0.34s both',
            }}>
              {STATS.map((s, i) => (
                <div key={s.label} style={{
                  flex: 1,
                  padding: '14px 16px',
                  borderRadius: i === 0 ? '12px 0 0 12px' : i === STATS.length - 1 ? '0 12px 12px 0' : '0',
                  background: T.bg3,
                  border: `1px solid ${T.border}`,
                  borderLeft: i > 0 ? 'none' : `1px solid ${T.border}`,
                }}>
                  <div style={{ color: s.color, fontWeight: 700, fontSize: '18px', letterSpacing: '-0.02em' }}>
                    {s.value}
                  </div>
                  <div style={{ color: T.text3, fontSize: '10px', marginTop: '2px', lineHeight: 1.4 }}>
                    {s.label}
                  </div>
                </div>
              ))}
            </div>

            {/* Testimonial snippet */}
            <div style={{
              marginTop: '24px', padding: '14px 16px',
              borderRadius: '12px', border: `1px solid ${T.border}`,
              background: T.bg3, position: 'relative', zIndex: 1,
              animation: 'ss-fade-up 0.6s cubic-bezier(0.16,1,0.3,1) 0.42s both',
            }}>
              <p style={{
                color: T.text2, fontSize: '12px', lineHeight: 1.6,
                margin: '0 0 10px', fontStyle: 'italic',
              }}>
                "Elara caught 'myself is Rahul' on my first session. I had been saying it for years. Got my SBI PO interview call three weeks later."
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{
                  width: '24px', height: '24px', borderRadius: '50%',
                  background: T.violetDim, border: `1px solid ${T.violet}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: T.violet, fontSize: '10px', fontWeight: 700,
                }}>P</div>
                <div>
                  <div style={{ color: T.text1, fontSize: '11px', fontWeight: 600 }}>Priya Sharma</div>
                  <div style={{ color: T.text3, fontSize: '10px' }}>SBI PO 2024 Qualified</div>
                </div>
              </div>
            </div>
          </div>

          {/* ══ RIGHT PANEL — sign-in form ════════════════ */}
          <div
            style={{
              width: '100%',
              maxWidth: '320px',
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              padding: '40px 32px',
              background: T.bg2,
            }}
          >
            {/* Mobile-only brand header */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              marginBottom: '28px',
              animation: 'ss-fade-up 0.5s cubic-bezier(0.16,1,0.3,1) 0.05s both',
            }}
              className="ss-mobile-brand"
            >
              <div style={{
                width: '36px', height: '36px', borderRadius: '10px',
                background: T.orangeDim,
                border: `1px solid ${T.orangeGlow}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <svg width="18" height="18" viewBox="0 0 36 36" fill="none">
                  <rect x="13" y="8" width="10" height="14" rx="5" fill={T.orange}/>
                  <path d="M10 20C10 24 13.6 27 18 27S26 24 26 20" stroke={T.orange} strokeWidth="2" strokeLinecap="round"/>
                  <line x1="18" y1="27" x2="18" y2="30" stroke={T.orange} strokeWidth="2" strokeLinecap="round"/>
                  <line x1="14" y1="30" x2="22" y2="30" stroke={T.orange} strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </div>
              <span style={{ color: T.text1, fontWeight: 700, fontSize: '16px', letterSpacing: '-0.03em' }}>
                Speak<span style={{ color: T.orange }}>Smart</span>
              </span>
            </div>

            {/* Form heading */}
            <div style={{
              animation: 'ss-fade-up 0.5s cubic-bezier(0.16,1,0.3,1) 0.12s both',
              marginBottom: '24px',
            }}>
              <h2 style={{
                color: T.text1, fontSize: '22px', fontWeight: 700,
                letterSpacing: '-0.04em', margin: '0 0 4px',
              }}>
                Welcome back
              </h2>
              <p style={{ color: T.text3, fontSize: '13px', margin: 0 }}>
                Sign in to continue your practice
              </p>
            </div>

            {/* ── Form ── */}
            <form
              onSubmit={handleSubmit}
              style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
            >
              {/* Email input */}
              <div style={{
                position: 'relative',
                animation: 'ss-fade-up 0.5s cubic-bezier(0.16,1,0.3,1) 0.18s both',
              }}>
                <label style={{
                  display: 'block',
                  fontSize: '11px', fontWeight: 600, letterSpacing: '0.06em',
                  color: emailFocus ? T.orange : T.text3,
                  marginBottom: '6px',
                  textTransform: 'uppercase',
                  transition: 'color 0.2s',
                }}>
                  Email
                </label>
                <input
                  type="email"
                  placeholder="you@example.com"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onFocus={() => setEmailFocus(true)}
                  onBlur={() => setEmailFocus(false)}
                  required
                  style={{
                    width: '100%',
                    padding: '11px 14px',
                    borderRadius: '10px',
                    background: T.bg3,
                    border: `1px solid ${emailFocus ? T.orange : T.border2}`,
                    color: T.text1,
                    fontSize: '13px',
                    outline: 'none',
                    boxSizing: 'border-box',
                    transition: 'border-color 0.2s, box-shadow 0.2s',
                    boxShadow: emailFocus ? `0 0 0 3px rgba(249,115,22,0.12)` : 'none',
                  }}
                />
              </div>

              {/* Password input */}
              <div style={{
                position: 'relative',
                animation: 'ss-fade-up 0.5s cubic-bezier(0.16,1,0.3,1) 0.24s both',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <label style={{
                    fontSize: '11px', fontWeight: 600, letterSpacing: '0.06em',
                    color: passwordFocus ? T.orange : T.text3,
                    textTransform: 'uppercase',
                    transition: 'color 0.2s',
                  }}>
                    Password
                  </label>
                  <button
                    type="button"
                    onClick={() => router.push('/forgot-password')}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: T.text3, fontSize: '11px', padding: 0,
                      transition: 'color 0.2s',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.color = T.orange)}
                    onMouseLeave={e => (e.currentTarget.style.color = T.text3)}
                  >
                    Forgot?
                  </button>
                </div>
                <input
                  type="password"
                  placeholder="••••••••"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onFocus={() => setPasswordFocus(true)}
                  onBlur={() => setPasswordFocus(false)}
                  required
                  style={{
                    width: '100%',
                    padding: '11px 14px',
                    borderRadius: '10px',
                    background: T.bg3,
                    border: `1px solid ${passwordFocus ? T.orange : T.border2}`,
                    color: T.text1,
                    fontSize: '13px',
                    outline: 'none',
                    boxSizing: 'border-box',
                    transition: 'border-color 0.2s, box-shadow 0.2s',
                    boxShadow: passwordFocus ? `0 0 0 3px rgba(249,115,22,0.12)` : 'none',
                  }}
                />
              </div>

              {/* Error message */}
              {error && (
                <div style={{
                  padding: '10px 14px',
                  borderRadius: '10px',
                  background: 'rgba(239,68,68,0.08)',
                  border: '1px solid rgba(239,68,68,0.2)',
                  color: '#EF4444',
                  fontSize: '12px',
                  lineHeight: 1.5,
                  animation: 'ss-fade-up 0.3s ease both',
                }}>
                  {error}
                </div>
              )}

              {/* Submit button */}
              <button
                type="submit"
                disabled={login.isPending}
                style={{
                  width: '100%',
                  padding: '12px',
                  borderRadius: '10px',
                  border: 'none',
                  cursor: login.isPending ? 'not-allowed' : 'pointer',
                  background: login.isPending
                    ? 'rgba(249,115,22,0.4)'
                    : `linear-gradient(135deg, ${T.orange} 0%, #F59E0B 100%)`,
                  color: '#fff',
                  fontSize: '14px',
                  fontWeight: 700,
                  letterSpacing: '0.01em',
                  transition: 'opacity 0.2s, transform 0.15s, box-shadow 0.2s',
                  marginTop: '4px',
                  boxShadow: login.isPending ? 'none' : '0 4px 20px rgba(249,115,22,0.35)',
                  animation: 'ss-fade-up 0.5s cubic-bezier(0.16,1,0.3,1) 0.30s both',
                }}
                onMouseEnter={e => {
                  if (!login.isPending) {
                    e.currentTarget.style.transform = 'translateY(-1px)';
                    e.currentTarget.style.boxShadow = '0 6px 28px rgba(249,115,22,0.45)';
                  }
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '0 4px 20px rgba(249,115,22,0.35)';
                }}
              >
                {login.isPending ? (
                  <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                      style={{ animation: 'spin 0.8s linear infinite' }}>
                      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
                    </svg>
                    Signing in…
                  </span>
                ) : (
                  'Sign In →'
                )}
              </button>
            </form>

            {/* Divider */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: '12px',
              margin: '20px 0',
              animation: 'ss-fade-up 0.5s cubic-bezier(0.16,1,0.3,1) 0.36s both',
            }}>
              <div style={{ flex: 1, height: '1px', background: T.border }} />
              <span style={{ color: T.text3, fontSize: '11px' }}>or</span>
              <div style={{ flex: 1, height: '1px', background: T.border }} />
            </div>

            {/* Register CTA */}
            <div style={{
              textAlign: 'center',
              animation: 'ss-fade-up 0.5s cubic-bezier(0.16,1,0.3,1) 0.42s both',
            }}>
              <p style={{ color: T.text3, fontSize: '13px', margin: '0 0 10px' }}>
                New to SpeakSmart?
              </p>
              <Link
                href="/register"
                style={{
                  display: 'block',
                  padding: '11px',
                  borderRadius: '10px',
                  border: `1px solid ${T.border2}`,
                  background: 'transparent',
                  color: T.text1,
                  fontSize: '13px',
                  fontWeight: 600,
                  textDecoration: 'none',
                  textAlign: 'center',
                  transition: 'border-color 0.2s, background 0.2s',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.borderColor = T.orange;
                  e.currentTarget.style.background = T.orangeDim;
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.borderColor = T.border2;
                  e.currentTarget.style.background = 'transparent';
                }}
              >
                Create free account
              </Link>
            </div>

            {/* Legal footer */}
            <p style={{
              textAlign: 'center',
              color: T.text3,
              fontSize: '10px',
              margin: '20px 0 0',
              lineHeight: 1.6,
              animation: 'ss-fade-up 0.5s cubic-bezier(0.16,1,0.3,1) 0.48s both',
            }}>
              By signing in, you agree to our{' '}
              <Link href="/terms" style={{ color: T.text3, textDecoration: 'underline' }}>Terms</Link>
              {' '}&amp;{' '}
              <Link href="/privacy" style={{ color: T.text3, textDecoration: 'underline' }}>Privacy Policy</Link>
            </p>
          </div>
        </div>

        {/* ── Responsive CSS ───────────────────────────── */}
        <style>{`
          @keyframes spin {
            from { transform: rotate(0deg); }
            to   { transform: rotate(360deg); }
          }

          /* Show left panel on md+ screens */
          @media (min-width: 640px) {
            .ss-left-panel {
              display: flex !important;
            }
            /* Hide mobile brand on desktop since left panel shows it */
            .ss-mobile-brand {
              display: none !important;
            }
          }

          /* On mobile: make form full-width */
          @media (max-width: 639px) {
            .ss-left-panel {
              display: none !important;
            }
          }

          input::placeholder {
            color: #5C5770;
          }
          input:-webkit-autofill {
            -webkit-box-shadow: 0 0 0 40px #13131f inset;
            -webkit-text-fill-color: #f0eeff;
          }
        `}</style>
      </div>
    </>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div />}>
      <LoginPageInner />
    </Suspense>
  );
}
