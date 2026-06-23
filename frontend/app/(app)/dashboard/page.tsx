'use client';

import React, { useEffect, useRef, useState } from 'react';
/**
 * app/(app)/dashboard/page.tsx — fully CSS-var themed, no hardcoded hex.
 */

import { useRouter } from 'next/navigation';
import { useMe } from '@/features/user/hooks';
import { useScoreHistory, useReadinessReport } from '@/features/analytics/hooks';
import { useSpeechTrend } from '@/features/speech/hooks';
import { useDailyQuestion } from '@/features/daily-question/hooks';
import { useMyPrepEnrollment } from '@/features/prep-paths/hooks';
import { useAuthStore } from '@/store/auth';
import { useUIStore } from '@/store/ui';
import { ProgressBar, Spinner, ScoreRing } from '@/components/ui';
import { formatDate, scoreColor } from '@/lib/utils';
import { Target, Zap, TrendingUp, Lightbulb, FileText, ExternalLink, Trophy, CalendarCheck } from 'lucide-react';
import { analytics } from '@/lib/analytics';
import { FLAG } from '@/lib/feature-flags'; // Bug #5 fix
import { JobLandedModal } from '@/components/shared/JobLandedModal';
import type { Session, WeakArea } from '@/types';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

const QUICK_STARTS = [
  { label: 'Software Dev',      desc: 'AI Chat · Friendly',   emoji: '💻', profession: 'Software Developer',        mode: 'chat' },
  { label: 'Bank PO',           desc: 'AI Chat · Technical',  emoji: '🏦', profession: 'Bank PO',                  mode: 'chat' },
  { label: 'Govt / SSC / UPSC', desc: 'Classic · Behavioral', emoji: '🏛️', profession: 'Government Job (SSC/UPSC)', mode: 'classic' },
];

function ScorePill({ score }: { score: number }) {
  const [bg, fg] =
    score >= 7 ? ['var(--success-dim)', 'var(--success)'] :
    score >= 5 ? ['var(--warn-dim)',    'var(--warn)']    :
                 ['var(--error-dim)',   'var(--error)'];
  return (
    <span className="text-xs font-bold px-2 py-0.5 rounded-md" style={{ background: bg, color: fg }}>
      {score}/10
    </span>
  );
}

export default function DashboardPage() {
  const { user }            = useAuthStore();
  const { showUpgradeModal } = useUIStore();
  const router              = useRouter();
  const { data: meData, isLoading } = useMe();
  const { data: history }   = useScoreHistory(10);
  const { data: dailyQ }    = useDailyQuestion();
  const { data: prepEnrollment } = useMyPrepEnrollment();
  const { data: speechTrend }  = useSpeechTrend();

  const stats        = meData?.stats;
  const usage        = meData?.usage;
  const jobReadiness = meData?.job_readiness;
  const weakAreas    = meData?.weak_areas ?? [];
  const recommendations = meData?.recommendations ?? [];
  // Derive plan from the live /me response so an upgrade takes effect
  // immediately without requiring a page refresh. Fall back to the Zustand
  // store only while meData is still loading (avoids a free→paid flash).
  const livePlan = meData?.user?.plan ?? user?.plan;
  const isFree       = !livePlan || livePlan === 'free';
  const isStarter    = livePlan === 'starter' || livePlan === 'pro' || livePlan === 'elite';
  const { data: readinessData } = useReadinessReport(isStarter);
  const readinessReport   = readinessData?.report ?? null;
  const sessionsUntilNext = readinessData?.sessions_until_next_report ?? null;
  const FREE_LIMIT   = usage?.limit ?? user?.ai_calls_limit ?? null;
  const aiUsed       = usage?.ai_calls ?? 0;
  const aiRemaining  = usage?.remaining ?? user?.ai_calls_remaining ?? null;
  const usagePct     = FREE_LIMIT ? Math.min(100, Math.round((aiUsed / FREE_LIMIT) * 100)) : 0;
  const name         = user?.name?.split(' ')[0] || 'there';
  const hasData      = (stats?.sessions ?? 0) > 0;

  // Job Landed card — show after 5+ sessions, hide once user has submitted
  // (job_landed_at non-null = already submitted, card gone forever).
  const [showJobLandedModal, setShowJobLandedModal] = useState(false);
  const hasJobLandedCard =
    (stats?.sessions ?? 0) >= 5 &&
    !(meData?.user as unknown as { job_landed_at?: string | null })?.job_landed_at;

  // day7_active — fire once per mount if the user is in the 6-8 day window
  // after signup. Uses a ref so a React Strict Mode double-invoke or a
  // fast remount doesn't double-fire within the same page load.
  const day7Fired = useRef(false);
  useEffect(() => {
    if (day7Fired.current || !meData) return;
    const createdAt = meData.user?.created_at ?? user?.created_at;
    if (!createdAt) return;

    const daysSinceSignup = Math.floor(
      (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24)
    );

    if (daysSinceSignup >= 6 && daysSinceSignup <= 8) {
      day7Fired.current = true;
      analytics.day7Active({ days_since_signup: daysSinceSignup });
    }
  }, [meData, user]);

  function handleQuickStart(profession: string, mode: string) {
    router.push(`/interview/setup?profession=${encodeURIComponent(profession)}&mode=${mode}`);
  }

  // Continue button on the Prep Path card — pre-fills the setup page from
  // today's day's session_config via the same ?profession=&mode= params
  // already read by interview/setup/page.tsx, plus difficulty/interview_type.
  function handleContinuePrepPath() {
    const today = prepEnrollment?.today;
    if (!today) return;
    const { profession, mode, difficulty, interview_type } = today.session_config;
    const qs = new URLSearchParams({ profession, mode, difficulty, interview_type });
    router.push(`/interview/setup?${qs.toString()}`);
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner size={28} style={{ color: 'var(--accent)' }} />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-5">

      {/* Greeting */}
      <div>
        <h1 className="text-xl font-bold" style={{ color: 'var(--text-1)', letterSpacing: '-0.02em' }}>
          Welcome back, {name} 👋
        </h1>
        <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>Here's where you stand today.</p>
      </div>

      {/* Daily Question Drop — Easy build item. Renders nothing while
          loading or if generation failed server-side (no fake fallback). */}
      {dailyQ?.question && (
        <div
          className="rounded-2xl p-4 border flex items-start gap-3"
          style={{ background: 'var(--blue-dim)', borderColor: 'var(--blue-border)' }}
        >
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'var(--surface)' }}
          >
            <Lightbulb className="w-4 h-4" style={{ color: 'var(--accent)' }} />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--accent)' }}>
              Today's Question
            </div>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--text-1)' }}>{dailyQ.question}</p>
          </div>
        </div>
      )}

      {/* Guided Prep Path — Phase 8 (P6-A). Shows the user's active enrollment
          ("Day 3 of 7 — Bank PO Prep") with a Continue button that pre-fills
          the setup page from today's day's session_config. Renders nothing
          if the user isn't enrolled in a path or it's still loading. */}
      {prepEnrollment?.enrollment && prepEnrollment.path && prepEnrollment.today && (
        <div
          className="rounded-2xl p-4 border flex items-center gap-3 flex-wrap"
          style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
        >
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'var(--accent-dim)' }}
          >
            <CalendarCheck className="w-4 h-4" style={{ color: 'var(--accent)' }} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-bold uppercase tracking-wide mb-0.5" style={{ color: 'var(--accent)' }}>
              Day {prepEnrollment.current_day} of {prepEnrollment.path.duration_days} — {prepEnrollment.path.title}
            </div>
            <p className="text-sm" style={{ color: 'var(--text-1)' }}>{prepEnrollment.today.title}</p>
          </div>
          <button
            onClick={handleContinuePrepPath}
            className="px-4 py-2 rounded-xl text-xs font-bold text-white transition-opacity hover:opacity-90 shrink-0"
            style={{ background: 'var(--accent)' }}
          >
            Continue
          </button>
        </div>
      )}


      {!hasData && (
        <div className="rounded-2xl p-8 text-center border" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
          <div className="text-5xl mb-4">🎙️</div>
          <h2 className="text-xl font-extrabold mb-2" style={{ color: 'var(--text-1)' }}>
            In 10 minutes, you'll know your{' '}
            <span style={{ background: 'var(--blue)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              exact weak areas
            </span>
          </h2>
          <p className="text-sm max-w-sm mx-auto mb-6 leading-relaxed" style={{ color: 'var(--text-2)' }}>
            Most candidates fail interviews without knowing why. Vachix shows you{' '}
            <strong style={{ color: 'var(--text-1)' }}>exactly what to fix</strong> — before your next real interview.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 rounded-2xl overflow-hidden mb-6 max-w-md mx-auto border"
            style={{ background: 'var(--surface-2)', borderColor: 'var(--border)' }}>
            {[
              { emoji: '🎯', title: 'Know your score',   sub: 'Ranked vs 10,000+ users' },
              { emoji: '🤖', title: 'AI pinpoints gaps', sub: 'Live feedback, every answer' },
              { emoji: '📈', title: 'Track improvement', sub: 'Session-by-session chart' },
            ].map((b, i) => (
              <div key={b.title} className="py-4 px-2 text-center" style={{ borderRight: i < 2 ? '1px solid var(--border)' : 'none' }}>
                <div className="text-xl mb-1">{b.emoji}</div>
                <div className="text-xs font-bold mb-0.5" style={{ color: 'var(--text-1)' }}>{b.title}</div>
                <div className="text-[10px]" style={{ color: 'var(--text-3)' }}>{b.sub}</div>
              </div>
            ))}
          </div>
          <button
            onClick={() => router.push('/interview/setup')}
            className="px-6 py-3 rounded-xl text-sm font-bold text-white transition-opacity hover:opacity-90"
            style={{ background: 'var(--blue)' }}
          >
            Start My First Interview Now
          </button>
          <p className="text-xs mt-3" style={{ color: 'var(--text-3)' }}>Free · No credit card · Results in under 10 mins</p>
        </div>
      )}

      {/* Stats row */}
      {hasData && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Streak',      value: stats?.streak ?? 0,                                         sub: 'days 🔥',           color: 'var(--warn)' },
            { label: 'Sessions',    value: stats?.sessions ?? 0,                                       sub: 'completed',          color: 'var(--accent)' },
            { label: 'Best Score',  value: stats?.best_score != null ? `${stats.best_score}/10` : '—', sub: 'personal best',      color: 'var(--success)' },
            { label: 'AI Sessions', value: aiUsed,                                                     sub: FREE_LIMIT ? `of ${FREE_LIMIT} used` : 'used', color: 'var(--accent)' },
          ].map((s: { label: string; value: string | number; sub: string; color: string }) => (
            <div key={s.label} className="rounded-xl p-4 text-center border" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
              <div className="text-[10px] uppercase tracking-wide mb-1" style={{ color: 'var(--text-3)' }}>{s.label}</div>
              <div className="text-2xl font-bold tabular-nums" style={{ color: s.color, letterSpacing: '-0.03em' }}>{s.value}</div>
              <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-3)' }}>{s.sub}</div>
            </div>
          ))}
        </div>
      )}

      {/* Usage bar — free users */}
      {isFree && hasData && (
        <div className="rounded-xl p-4 border" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold flex items-center gap-1.5" style={{ color: 'var(--text-2)' }}>
              <Zap className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
              AI Sessions Used
            </span>
            <span className="text-sm font-bold tabular-nums" style={{ color: 'var(--text-1)' }}>
              {aiUsed}{FREE_LIMIT ? ` / ${FREE_LIMIT}` : ''}
            </span>
          </div>
          <ProgressBar
            value={aiUsed}
            max={FREE_LIMIT ?? aiUsed + 1}
            color={usagePct >= 80 ? 'var(--error)' : usagePct >= 60 ? 'var(--warn)' : 'var(--accent)'}
            animated
          />
          <p className="text-xs mt-2" style={{ color: 'var(--text-2)' }}>
            {aiRemaining != null ? `${aiRemaining} sessions remaining. ` : ''}
            <button onClick={() => showUpgradeModal('strip')} className="hover:underline" style={{ color: 'var(--accent)' }}>
              Upgrade for unlimited →
            </button>
          </p>
        </div>
      )}

      {/* Two-column: Recent + Quick Start */}
      {hasData && (
        <div className="grid md:grid-cols-2 gap-4">
          {/* Recent Sessions */}
          <div className="rounded-2xl border overflow-hidden" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
            <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
              <span className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>Recent Sessions</span>
              <button onClick={() => router.push('/history')} className="text-xs font-medium hover:underline" style={{ color: 'var(--accent)' }}>
                View all →
              </button>
            </div>
            <div>
              {(history ?? []).slice(0, 4).map((s: Session) => (
                <button
                  key={s.id}
                  onClick={() => router.push(`/interview/summary?session=${s.id}`)}
                  className="w-full flex items-center justify-between px-4 py-3 border-b text-left transition-colors last:border-0"
                  style={{ borderColor: 'var(--border)' }}
                  onMouseEnter={(e: React.MouseEvent<HTMLElement>) => (e.currentTarget.style.background = 'var(--surface-2)')}
                  onMouseLeave={(e: React.MouseEvent<HTMLElement>) => (e.currentTarget.style.background = 'transparent')}
                >
                  <div>
                    <div className="text-xs font-medium" style={{ color: 'var(--text-1)' }}>{s.profession}</div>
                    <div className="text-[10px]" style={{ color: 'var(--text-3)' }}>{formatDate(s.created_at)}</div>
                  </div>
                  <ScorePill score={s.score} />
                </button>
              ))}
              {!history?.length && (
                <div className="px-4 py-8 text-center text-xs" style={{ color: 'var(--text-3)' }}>No sessions yet.</div>
              )}
            </div>
          </div>

          {/* Quick Start */}
          <div className="rounded-2xl border overflow-hidden" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
            <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
              <Zap className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
              <span className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>Quick Start</span>
            </div>
            <div>
              {QUICK_STARTS.map((qs) => (
                <button
                  key={qs.label}
                  onClick={() => handleQuickStart(qs.profession, qs.mode)}
                  className="w-full flex items-center gap-3 px-4 py-3 border-b text-left transition-colors last:border-0"
                  style={{ borderColor: 'var(--border)' }}
                  onMouseEnter={(e: React.MouseEvent<HTMLElement>) => (e.currentTarget.style.background = 'var(--surface-2)')}
                  onMouseLeave={(e: React.MouseEvent<HTMLElement>) => (e.currentTarget.style.background = 'transparent')}
                >
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg flex-shrink-0"
                    style={{ background: 'var(--accent-dim)' }}>
                    {qs.emoji}
                  </div>
                  <div>
                    <div className="text-xs font-semibold" style={{ color: 'var(--text-1)' }}>{qs.label}</div>
                    <div className="text-[10px]" style={{ color: 'var(--text-3)' }}>{qs.desc}</div>
                  </div>
                </button>
              ))}
              {!prepEnrollment?.enrollment && (
                <button
                  onClick={() => router.push('/prep-paths')}
                  className="w-full flex items-center gap-3 px-4 py-3 border-b text-left transition-colors"
                  style={{ borderColor: 'var(--border)' }}
                  onMouseEnter={(e: React.MouseEvent<HTMLElement>) => (e.currentTarget.style.background = 'var(--surface-2)')}
                  onMouseLeave={(e: React.MouseEvent<HTMLElement>) => (e.currentTarget.style.background = 'transparent')}
                >
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg flex-shrink-0"
                    style={{ background: 'var(--accent-dim)' }}>
                    <CalendarCheck className="w-4 h-4" style={{ color: 'var(--accent)' }} />
                  </div>
                  <div>
                    <div className="text-xs font-semibold" style={{ color: 'var(--text-1)' }}>Try a Guided Prep Path</div>
                    <div className="text-[10px]" style={{ color: 'var(--text-3)' }}>Structured day-by-day tracks for Bank PO, UPSC & more</div>
                  </div>
                </button>
              )}
              <button
                onClick={() => router.push('/interview/setup')}
                className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors"
                onMouseEnter={(e: React.MouseEvent<HTMLElement>) => (e.currentTarget.style.background = 'var(--surface-2)')}
                onMouseLeave={(e: React.MouseEvent<HTMLElement>) => (e.currentTarget.style.background = 'transparent')}
              >
                <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg flex-shrink-0"
                  style={{ background: 'var(--surface-3)' }}>
                  ✦
                </div>
                <div>
                  <div className="text-xs font-semibold" style={{ color: 'var(--accent)' }}>Browse all tracks →</div>
                  <div className="text-[10px]" style={{ color: 'var(--text-3)' }}>11 career tracks available</div>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Job Readiness */}
      {hasData && jobReadiness && (
        <div className="rounded-2xl p-5 border" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-2 mb-4">
            <Target className="w-4 h-4" style={{ color: 'var(--accent)' }} />
            <span className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>Interview Readiness</span>
          </div>
          <div className="flex items-center gap-5">
            <ScoreRing score={jobReadiness.score} size={76} />
            <div>
              <div className="text-sm font-semibold mb-1" style={{ color: 'var(--text-1)' }}>{jobReadiness.label}</div>
              <p className="text-xs leading-relaxed max-w-xs" style={{ color: 'var(--text-2)' }}>{jobReadiness.message}</p>
            </div>
          </div>
        </div>
      )}

      {/* Recommendations */}
      {recommendations.length > 0 && (
        <div className="rounded-2xl border overflow-hidden" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
            <Lightbulb className="w-4 h-4" style={{ color: 'var(--accent)' }} />
            <span className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>Recommended for you</span>
          </div>
          <div className="px-4 py-4 space-y-3">
            {recommendations.map((rec, i) => (
              <div key={i} className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <div className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>{rec.title}</div>
                  <p className="text-xs leading-relaxed max-w-md" style={{ color: 'var(--text-2)' }}>{rec.reason}</p>
                </div>
                {rec.action && (
                  <button
                    onClick={() => router.push('/interview/setup')}
                    className="text-xs font-semibold px-3 py-1.5 rounded-lg shrink-0"
                    style={{ background: 'var(--accent)', color: 'var(--surface)' }}
                  >
                    {rec.action}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Weak Areas */}
      {weakAreas.length > 0 && (
        <div className="rounded-2xl border overflow-hidden" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
            <TrendingUp className="w-4 h-4" style={{ color: 'var(--error)' }} />
            <span className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>Areas to Improve</span>
          </div>
          <div className="px-4 py-4 space-y-4">
            {weakAreas.map((wa: WeakArea) => (
              <div key={wa.topic}>
                <ProgressBar
                  value={wa.avg_score}
                  max={10}
                  label={wa.topic}
                  showValue
                  animated
                  color={
                    wa.avg_score >= 7 ? 'var(--success)' :
                    wa.avg_score >= 5 ? 'var(--warn)' :
                    'var(--error)'
                  }
              />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Interview Readiness Report — Starter+ only, only when a report exists */}
      {isStarter && readinessReport && (
        <div className="rounded-2xl border overflow-hidden" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
            <span className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--text-1)' }}>
              <FileText className="w-4 h-4" style={{ color: 'var(--accent)' }} />
              Interview Readiness Report
            </span>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-md" style={{ background: 'var(--blue-dim)', color: 'var(--accent)' }}>
              After session {readinessReport.session_count}
            </span>
          </div>

          {/* Report body */}
          <div className="px-4 py-4">
            <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--text-2)' }}>
              {readinessReport.report_text}
            </p>

            {/* Footer row: avg score + next checkpoint + cert link */}
            <div className="mt-4 pt-3 border-t flex flex-wrap items-center justify-between gap-3" style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-center gap-4">
                {readinessReport.avg_score != null && (
                  <div className="text-center">
                    <div className="text-[10px] uppercase tracking-wide mb-0.5" style={{ color: 'var(--text-3)' }}>Avg Score</div>
                    <div
                      className="text-lg font-bold tabular-nums"
                      style={{ color: readinessReport.avg_score >= 7 ? 'var(--success)' : readinessReport.avg_score >= 5 ? 'var(--warn)' : 'var(--error)' }}
                    >
                      {readinessReport.avg_score.toFixed(1)}/10
                    </div>
                  </div>
                )}
                {sessionsUntilNext != null && (
                  <div className="text-center">
                    <div className="text-[10px] uppercase tracking-wide mb-0.5" style={{ color: 'var(--text-3)' }}>Next Report</div>
                    <div className="text-sm font-semibold" style={{ color: 'var(--text-2)' }}>
                      {sessionsUntilNext} session{sessionsUntilNext !== 1 ? 's' : ''} away
                    </div>
                  </div>
                )}
              </div>

              {/* View Certificate */}
              <button
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg"
                style={{ background: 'var(--blue-dim)', color: 'var(--accent)' }}
                onClick={async () => {
                  try {
                    const { analyticsApi } = await import('@/features/analytics/api');
                    const res = await analyticsApi.getReadinessCertificateToken();
                    if (res.ok && res.data.cert_url) {
                      window.open(res.data.cert_url, '_blank', 'noopener');
                    }
                  } catch {
                    // silently ignore — certificate is a nice-to-have
                  }
                }}
              >
                <ExternalLink className="w-3.5 h-3.5" />
                View Certificate
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Speech Trends card — Beta (P5)
           Gated by FLAG.SPEECH_ANALYTICS_CARD (Bug #5 fix) AND requires 3+
           sessions with recorded metrics so the chart has a meaningful trend
           line rather than a single dot. Set NEXT_PUBLIC_FF_SPEECH_ANALYTICS_CARD=true
           to enable. Labelled "Beta" because WPM is an estimate (typed, not spoken)
           and filler detection is heuristic, not ML-based. */}
      {FLAG.SPEECH_ANALYTICS_CARD && (speechTrend ?? []).length >= 3 && (
        <div className="rounded-2xl border overflow-hidden" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
            <span className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--text-1)' }}>
              🗣️ Speech Trends
            </span>
            <span
              className="text-[10px] font-bold px-2 py-0.5 rounded-md"
              style={{ background: 'var(--warn-dim)', color: 'var(--warn)' }}
            >
              Beta
            </span>
          </div>

          {/* Charts */}
          <div className="px-4 pt-4 pb-5 space-y-6">

            {/* WPM chart */}
            <div>
              <div className="text-[10px] uppercase tracking-wide mb-2" style={{ color: 'var(--text-3)' }}>
                Typing Speed (WPM)
              </div>
              <ResponsiveContainer width="100%" height={100}>
                <LineChart data={speechTrend} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis
                    dataKey="created_at"
                    tickFormatter={(v: string) => new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                    tick={{ fontSize: 9, fill: 'var(--text-3)' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 9, fill: 'var(--text-3)' }}
                    axisLine={false}
                    tickLine={false}
                    allowDecimals={false}
                  />
                  <Tooltip
                    contentStyle={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 11 }}
                    labelFormatter={(v: string) => new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                    formatter={(v: number) => [`${v} wpm`, 'Speed']}
                  />
                  <Line
                    type="monotone"
                    dataKey="wpm"
                    stroke="var(--accent)"
                    strokeWidth={2}
                    dot={{ r: 3, fill: 'var(--accent)' }}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Filler count chart */}
            <div>
              <div className="text-[10px] uppercase tracking-wide mb-2" style={{ color: 'var(--text-3)' }}>
                Filler Words Per Session
              </div>
              <ResponsiveContainer width="100%" height={100}>
                <LineChart data={speechTrend} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis
                    dataKey="created_at"
                    tickFormatter={(v: string) => new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                    tick={{ fontSize: 9, fill: 'var(--text-3)' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 9, fill: 'var(--text-3)' }}
                    axisLine={false}
                    tickLine={false}
                    allowDecimals={false}
                  />
                  <Tooltip
                    contentStyle={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 11 }}
                    labelFormatter={(v: string) => new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                    formatter={(v: number) => [`${v}`, 'Fillers']}
                  />
                  <Line
                    type="monotone"
                    dataKey="filler_count"
                    stroke="var(--warn)"
                    strokeWidth={2}
                    dot={{ r: 3, fill: 'var(--warn)' }}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
              <p className="text-[10px] mt-2 leading-relaxed" style={{ color: 'var(--text-3)' }}>
                Lower is better. Common fillers include "um", "uh", "like", "basically", "so".
                Detected from your typed answers — estimates only.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Upgrade strip */}
      {isFree && (stats?.sessions ?? 0) >= 3 && (
        <div className="rounded-xl p-4 flex items-center justify-between gap-4 flex-wrap border"
          style={{ background: 'var(--blue-dim)', borderColor: 'var(--blue-border)' }}>
          <div>
            <div className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>🚀 You're improving!</div>
            <div className="text-xs mt-0.5" style={{ color: 'var(--text-2)' }}>Unlock unlimited sessions to keep your momentum.</div>
          </div>
          <button
            onClick={() => showUpgradeModal('nudge')}
            className="text-xs font-bold text-white px-4 py-2 rounded-lg whitespace-nowrap"
            style={{ background: 'var(--blue)' }}
          >
            Upgrade → ₹699/mo
          </button>
        </div>
      )}

      {/* Job Landed card — shown after ≥5 sessions, hidden once submitted */}
      {hasData && hasJobLandedCard && (
        <div
          className="rounded-xl p-4 flex items-center justify-between gap-4 flex-wrap border"
          style={{ background: 'var(--success-dim)', borderColor: 'var(--success)' }}
        >
          <div className="flex items-center gap-3">
            <Trophy className="w-5 h-5 flex-shrink-0" style={{ color: 'var(--success)' }} />
            <div>
              <div className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>
                🎉 Did Vachix help you land a job?
              </div>
              <div className="text-xs mt-0.5" style={{ color: 'var(--text-2)' }}>
                Share your win — inspire thousands of other candidates.
              </div>
            </div>
          </div>
          <button
            onClick={() => setShowJobLandedModal(true)}
            className="text-xs font-bold px-4 py-2 rounded-lg whitespace-nowrap"
            style={{ background: 'var(--success)', color: '#fff' }}
          >
            I Got the Job! 🚀
          </button>
        </div>
      )}

      {/* Job Landed modal */}
      {showJobLandedModal && (
        <JobLandedModal
          onClose={() => setShowJobLandedModal(false)}
          userName={user?.name ?? 'User'}
        />
      )}

    </div>
  );
}
