'use client';

import { useRouter } from 'next/navigation';
import { useMe } from '@/features/user/hooks';
import { useScoreHistory } from '@/features/analytics/hooks';
import { useAuthStore } from '@/store/auth';
import { useUIStore } from '@/store/ui';
import { ProgressBar, Spinner } from '@/components/ui';
import { formatDate, scoreColor } from '@/lib/utils';
import { Target } from 'lucide-react';

// ── Design tokens (matching redesign preview) ──────────────────────
const T = {
  bg:          '#0C0A10',
  surface:     '#141118',
  surface2:    '#1E1A26',
  border:      'rgba(255,255,255,0.07)',
  border2:     'rgba(255,255,255,0.13)',
  orange:      '#F97316',
  orangeDim:   'rgba(249,115,22,0.12)',
  violet:      '#8B5CF6',
  violetDim:   'rgba(139,92,246,0.12)',
  emerald:     '#10B981',
  emeraldDim:  'rgba(16,185,129,0.12)',
  amber:       '#F59E0B',
  text1:       '#F5F3FF',
  text2:       '#9490A8',
  text3:       '#5C5770',
};

// ── Quick-start presets ────────────────────────────────────────────
const QUICK_STARTS = [
  { label: 'Software Dev', desc: 'AI Chat · Friendly', emoji: '💻', bg: 'rgba(249,115,22,0.1)', profession: 'Software Developer', mode: 'chat' },
  { label: 'Bank PO', desc: 'AI Chat · Technical', emoji: '🏦', bg: 'rgba(16,185,129,0.1)', profession: 'Bank PO', mode: 'chat' },
  { label: 'Govt / SSC / UPSC', desc: 'Classic · Behavioral', emoji: '🏛️', bg: 'rgba(245,158,11,0.1)', profession: 'Government Job (SSC/UPSC)', mode: 'classic' },
];

// ── Score badge helper ─────────────────────────────────────────────
function ScorePill({ score }: { score: number }) {
  const good = score >= 7;
  const mid  = score >= 5;
  const style = good
    ? { background: 'rgba(16,185,129,0.12)', color: '#10B981' }
    : mid
    ? { background: 'rgba(245,158,11,0.12)', color: '#F59E0B' }
    : { background: 'rgba(239,68,68,0.12)', color: '#EF4444' };
  return (
    <span className="text-xs font-bold px-1.5 py-0.5 rounded-md" style={style}>
      {score}/10
    </span>
  );
}

export default function DashboardPage() {
  const { user } = useAuthStore();
  const { showUpgradeModal } = useUIStore();
  const router = useRouter();
  const { data: meData, isLoading } = useMe();
  const { data: history } = useScoreHistory(10);

  const stats       = meData?.stats;
  const usage       = meData?.usage;
  const jobReadiness = meData?.job_readiness;
  const weakAreas   = meData?.weak_areas ?? [];
  const isFree      = !user || (user.plan !== 'pro' && user.plan !== 'elite');
  const FREE_LIMIT  = usage?.limit ?? user?.ai_calls_limit ?? null;
  const aiUsed      = usage?.ai_calls ?? 0;
  const aiRemaining = usage?.remaining ?? user?.ai_calls_remaining ?? null;
  const usagePct    = FREE_LIMIT ? Math.min(100, Math.round((aiUsed / FREE_LIMIT) * 100)) : 0;

  const name    = user?.name?.split(' ')[0] || 'there';
  const hasData = (stats?.sessions ?? 0) > 0;

  function handleQuickStart(profession: string | null, mode: string | null) {
    if (!profession) { router.push('/interview/setup'); return; }
    router.push(`/interview/setup?profession=${encodeURIComponent(profession)}&mode=${mode}`);
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner className="w-8 h-8" style={{ color: T.orange }} />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-5 max-w-5xl mx-auto space-y-4">

      {/* ── Greeting ── */}
      <div>
        <h1 className="text-xl font-bold" style={{ color: T.text1, letterSpacing: '-0.02em' }}>
          Welcome back, {name} 👋
        </h1>
        <p className="text-xs mt-0.5" style={{ color: T.text2 }}>Here's where you stand today.</p>
      </div>

      {/* ── Empty state ── */}
      {!hasData && (
        <div
          className="rounded-2xl p-8 text-center border"
          style={{ background: T.surface, borderColor: T.border }}
        >
          <div className="text-5xl mb-4">🎙️</div>
          <h2 className="text-xl font-extrabold mb-2" style={{ color: T.text1 }}>
            In 10 minutes, you'll know your{' '}
            <span style={{ color: T.orange }}>exact weak areas</span>
          </h2>
          <p className="text-sm max-w-sm mx-auto mb-6 leading-relaxed" style={{ color: T.text2 }}>
            Most candidates fail interviews without knowing why. SpeakSmart shows you{' '}
            <strong style={{ color: T.text1 }}>exactly what to fix</strong> — before your next real interview.
          </p>
          <div
            className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x rounded-2xl overflow-hidden mb-6 max-w-md mx-auto border"
            style={{ background: T.surface2, borderColor: T.border, '--tw-divide-color': T.border } as any}
          >
            {[
              { emoji: '🎯', title: 'Know your score', sub: 'Ranked vs 10,000+ users' },
              { emoji: '🤖', title: 'AI pinpoints gaps', sub: 'Live feedback, every answer' },
              { emoji: '📈', title: 'Track improvement', sub: 'Session-by-session chart' },
            ].map((b) => (
              <div key={b.title} className="py-3 px-2 text-center">
                <div className="text-xl mb-1">{b.emoji}</div>
                <div className="text-xs font-bold mb-0.5" style={{ color: T.text1 }}>{b.title}</div>
                <div className="text-[10px]" style={{ color: T.text3 }}>{b.sub}</div>
              </div>
            ))}
          </div>
          <button
            onClick={() => router.push('/interview/setup')}
            className="px-6 py-3 rounded-xl text-sm font-bold text-white transition-opacity hover:opacity-90"
            style={{ background: `linear-gradient(135deg, ${T.orange}, ${T.amber})` }}
          >
            Start My First Interview Now
          </button>
          <p className="text-xs mt-3" style={{ color: T.text3 }}>Free · No credit card · Results in under 10 mins</p>
        </div>
      )}

      {/* ── Stats row ── */}
      {hasData && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { label: 'Streak',     value: stats?.streak ?? 0,                                  sub: 'days 🔥',        color: T.amber   },
            { label: 'Sessions',   value: stats?.sessions ?? 0,                                sub: 'practiced',      color: T.orange  },
            { label: 'Best Score', value: stats?.best_score != null ? `${stats.best_score}/10` : '—', sub: 'personal best', color: T.emerald },
            { label: 'AI Sessions', value: aiUsed, sub: FREE_LIMIT ? `of ${FREE_LIMIT} used` : 'sessions used', color: T.violet },
          ].map((s) => (
            <div
              key={s.label}
              className="rounded-xl p-3 text-center border"
              style={{ background: T.surface, borderColor: T.border }}
            >
              <div className="text-[10px] mb-1" style={{ color: T.text3 }}>{s.label}</div>
              <div className="text-2xl font-bold" style={{ color: s.color, letterSpacing: '-0.03em' }}>{s.value}</div>
              <div className="text-[9px] mt-0.5" style={{ color: T.text3 }}>{s.sub}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── Usage bar (free users) ── */}
      {isFree && hasData && (
        <div className="rounded-xl p-4 border" style={{ background: T.surface, borderColor: T.border }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: T.text2 }}>AI Sessions Used</span>
            <span className="text-sm font-bold" style={{ color: T.text1 }}>{aiUsed}{FREE_LIMIT ? ` / ${FREE_LIMIT}` : ''}</span>
          </div>
          <ProgressBar
            value={aiUsed}
            max={FREE_LIMIT ?? aiUsed + 1}
            barClassName={usagePct >= 80 ? 'bg-red-400' : usagePct >= 60 ? 'bg-amber-400' : undefined}
            style={usagePct < 60 ? { '--bar-color': T.orange } as any : undefined}
          />
          <p className="text-xs mt-2" style={{ color: T.text2 }}>
            {aiRemaining != null ? `${aiRemaining} sessions remaining. ` : 'Check back for usage details. '}
            <button onClick={() => showUpgradeModal('strip')} style={{ color: T.orange }} className="hover:underline">
              Upgrade for unlimited →
            </button>
          </p>
        </div>
      )}

      {/* ── Two-col: Recent Sessions + Quick Start ── */}
      {hasData && (
        <div className="grid md:grid-cols-2 gap-3">
          {/* Recent Sessions */}
          <div className="rounded-2xl border overflow-hidden" style={{ background: T.surface, borderColor: T.border }}>
            <div
              className="flex items-center justify-between px-3.5 py-2.5 border-b text-sm font-semibold"
              style={{ borderColor: T.border, color: T.text1 }}
            >
              Recent Sessions
              <button
                onClick={() => router.push('/history')}
                className="text-xs font-medium"
                style={{ color: T.orange }}
              >
                View all →
              </button>
            </div>
            <div>
              {(history ?? []).slice(0, 3).map((s) => (
                <button
                  key={s.id}
                  onClick={() => router.push(`/interview/summary?session=${s.id}`)}
                  className="w-full flex items-center justify-between px-3.5 py-2.5 border-b text-left transition-colors last:border-0"
                  style={{ borderColor: T.border }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.03)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <div>
                    <div className="text-xs font-medium" style={{ color: T.text1 }}>{s.profession}</div>
                    <div className="text-[10px]" style={{ color: T.text3 }}>{formatDate(s.created_at)}</div>
                  </div>
                  <ScorePill score={s.score} />
                </button>
              ))}
              {!history?.length && (
                <div className="px-3.5 py-6 text-center text-xs" style={{ color: T.text3 }}>
                  No sessions yet — start your first interview!
                </div>
              )}
            </div>
          </div>

          {/* Quick Start */}
          <div className="rounded-2xl border overflow-hidden" style={{ background: T.surface, borderColor: T.border }}>
            <div
              className="px-3.5 py-2.5 border-b text-sm font-semibold"
              style={{ borderColor: T.border, color: T.text1 }}
            >
              ⚡ Quick Start
            </div>
            <div>
              {QUICK_STARTS.map((qs) => (
                <button
                  key={qs.label}
                  onClick={() => handleQuickStart(qs.profession, qs.mode)}
                  className="w-full flex items-center gap-3 px-3.5 py-2.5 border-b text-left transition-colors last:border-0"
                  style={{ borderColor: T.border }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.03)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <div
                    className="w-8 h-8 rounded-xl flex items-center justify-center text-base flex-shrink-0"
                    style={{ background: qs.bg }}
                  >
                    {qs.emoji}
                  </div>
                  <div>
                    <div className="text-xs font-semibold" style={{ color: T.text1 }}>{qs.label}</div>
                    <div className="text-[10px]" style={{ color: T.text3 }}>{qs.desc}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Job Readiness ── */}
      {hasData && jobReadiness && (
        <div className="rounded-2xl p-4 border" style={{ background: T.surface, borderColor: T.border }}>
          <div className="text-[10px] font-semibold uppercase tracking-wide mb-4" style={{ color: T.text2 }}>
            🎯 Your Interview Readiness
          </div>
          <div className="flex items-center gap-5">
            <div
              className="flex-shrink-0 w-[70px] h-[70px] rounded-full flex flex-col items-center justify-center"
              style={{ border: `3px solid rgba(249,115,22,0.25)`, background: 'rgba(249,115,22,0.05)' }}
            >
              <span className="text-xl font-bold" style={{ color: T.orange }}>{jobReadiness.score}</span>
              <span className="text-[8px] uppercase tracking-wide" style={{ color: T.text3 }}>Job Ready</span>
            </div>
            <div>
              <div className="text-sm font-semibold mb-1" style={{ color: T.text1 }}>{jobReadiness.label}</div>
              <p className="text-xs leading-relaxed max-w-xs" style={{ color: T.text2 }}>{jobReadiness.message}</p>
            </div>
          </div>
        </div>
      )}

      {/* ── Weak Areas ── */}
      {weakAreas.length > 0 && (
        <div className="rounded-2xl border overflow-hidden" style={{ background: T.surface, borderColor: T.border }}>
          <div className="px-3.5 py-2.5 border-b text-sm font-semibold flex items-center gap-2"
            style={{ borderColor: T.border, color: T.text1 }}>
            <Target className="w-4 h-4" style={{ color: '#EF4444' }} /> Weak Areas
          </div>
          <div className="px-3.5 py-3 space-y-3">
            {weakAreas.map((wa) => (
              <div key={wa.topic}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="font-medium" style={{ color: T.text1 }}>{wa.topic}</span>
                  <span style={{ color: scoreColor(wa.avg_score) }}>{wa.avg_score.toFixed(1)}/10</span>
                </div>
                <ProgressBar value={wa.avg_score} max={10} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Upgrade strip ── */}
      {isFree && (stats?.sessions ?? 0) >= 3 && (
        <div
          className="rounded-xl p-3.5 flex items-center justify-between gap-4 flex-wrap border"
          style={{
            background: 'linear-gradient(135deg, rgba(249,115,22,0.1), rgba(139,92,246,0.1))',
            borderColor: 'rgba(249,115,22,0.25)',
          }}
        >
          <div>
            <div className="text-sm font-semibold" style={{ color: T.text1 }}>🚀 You're improving!</div>
            <div className="text-xs" style={{ color: T.text2 }}>Unlock unlimited sessions to keep your momentum.</div>
          </div>
          <button
            onClick={() => showUpgradeModal('nudge')}
            className="text-xs font-bold text-white px-3.5 py-2 rounded-lg border-none whitespace-nowrap"
            style={{ background: `linear-gradient(135deg, ${T.orange}, ${T.amber})` }}
          >
            Upgrade → ₹299/mo
          </button>
        </div>
      )}

    </div>
  );
}
