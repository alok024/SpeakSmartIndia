'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useMe, useLogout } from '@/hooks/queries';
import { useCompleteOnboarding } from '@/features/user/hooks';
import { useAuthStore } from '@/store/auth';
import { useUIStore } from '@/store/ui';
import { Button, Card, CardHeader, CardBody, Badge, ProgressBar, Spinner } from '@/components/ui';
import { formatDate } from '@/lib/utils';
import { LogOut, Crown, Diamond } from 'lucide-react';
import { QK } from '@/lib/query-keys';

// ── Onboarding options ────────────────────────────────────────────

const PROFESSIONS = [
  'Software Engineering',
  'Data Science / AI',
  'Product Management',
  'Business Analyst',
  'Marketing',
  'Finance / Banking',
  'HR / Recruiting',
  'Sales',
  'Operations',
  'Other',
];

const GOALS = [
  'Get my first job',
  'Switch companies',
  'Get promoted',
  'Improve confidence',
  'Practice regularly',
];

// ── Onboarding form ───────────────────────────────────────────────

function OnboardingForm({ onDone }: { onDone: () => void }) {
  const [profession, setProfession] = useState('');
  const [goal, setGoal] = useState('');
  const [error, setError] = useState('');
  const completeOnboarding = useCompleteOnboarding();

  async function handleSubmit() {
    if (!profession || !goal) {
      setError('Please select both a field and a goal.');
      return;
    }
    setError('');
    const res = await completeOnboarding.mutateAsync({ profession, goal });
    if (res.ok) {
      onDone();
    } else {
      setError('Something went wrong. Please try again.');
    }
  }

  return (
    <div className="min-h-screen bg-[#0E0F14] flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <div className="text-3xl mb-2">👋</div>
          <h1 className="text-2xl font-bold text-white">Welcome to SpeakSmart</h1>
          <p className="text-sm text-[#8B90A0] mt-1">Tell us about yourself so we can personalise your practice.</p>
        </div>

        {/* Profession */}
        <Card className="p-5">
          <div className="text-sm font-semibold text-white mb-3">What's your field?</div>
          <div className="grid grid-cols-2 gap-2">
            {PROFESSIONS.map((p) => (
              <button
                key={p}
                onClick={() => setProfession(p)}
                className={`text-sm px-3 py-2 rounded-lg border transition-all text-left ${
                  profession === p
                    ? 'border-[#4F8EF7] bg-[#4F8EF7]/10 text-white'
                    : 'border-white/10 text-[#8B90A0] hover:border-white/30 hover:text-white'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </Card>

        {/* Goal */}
        <Card className="p-5">
          <div className="text-sm font-semibold text-white mb-3">What's your main goal?</div>
          <div className="space-y-2">
            {GOALS.map((g) => (
              <button
                key={g}
                onClick={() => setGoal(g)}
                className={`w-full text-sm px-4 py-2.5 rounded-lg border transition-all text-left ${
                  goal === g
                    ? 'border-[#4F8EF7] bg-[#4F8EF7]/10 text-white'
                    : 'border-white/10 text-[#8B90A0] hover:border-white/30 hover:text-white'
                }`}
              >
                {g}
              </button>
            ))}
          </div>
        </Card>

        {error && <p className="text-xs text-red-400 text-center">{error}</p>}

        <Button
          className="w-full"
          onClick={handleSubmit}
          loading={completeOnboarding.isPending}
          disabled={!profession || !goal}
        >
          Get Started →
        </Button>
      </div>
    </div>
  );
}

// ── Main profile page ─────────────────────────────────────────────

export default function ProfilePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const { showUpgradeModal } = useUIStore();
  const { data: meData, isLoading } = useMe();
  const logout = useLogout();

  const isOnboarding = searchParams.get('onboarding') === '1' && !meData?.onboarding?.completed;

  const stats = meData?.stats;
  const usage = meData?.usage;
  const isFree = !user || (user.plan !== 'pro' && user.plan !== 'elite');
  const FREE_LIMIT = usage?.limit ?? user?.ai_calls_limit ?? null;
  const aiUsed = usage?.ai_calls ?? 0;
  const aiRemaining = usage?.remaining ?? user?.ai_calls_remaining ?? null;

  const planLabel = user?.plan === 'elite' ? '◈ Elite' : user?.plan === 'pro' ? '✦ Pro' : 'Free';
  const planBadgeVariant = user?.plan === 'elite' ? 'elite' : user?.plan === 'pro' ? 'pro' : 'free';

  async function handleLogout() {
    await logout.mutateAsync();
    qc.clear();
    router.push('/login');
  }

  function handleOnboardingDone() {
    qc.invalidateQueries({ queryKey: QK.me });
    router.replace('/dashboard');
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner className="w-8 h-8 text-blue-400" />
      </div>
    );
  }

  // Show onboarding form if not yet completed
  if (isOnboarding) {
    return <OnboardingForm onDone={handleOnboardingDone} />;
  }

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto space-y-5">
      <h1 className="text-2xl font-bold text-white">Profile & Plan</h1>

      {/* User card */}
      <Card className="p-5">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-500/30 to-purple-500/30 flex items-center justify-center text-xl font-bold text-white">
            {(user?.name?.[0] ?? user?.email?.[0] ?? '?').toUpperCase()}
          </div>
          <div>
            <div className="text-lg font-bold text-white">{user?.name ?? '—'}</div>
            <div className="text-sm text-[#8B90A0]">{user?.email}</div>
            <Badge variant={planBadgeVariant} size="sm" className="mt-1">{planLabel} Plan</Badge>
          </div>
        </div>
      </Card>

      {/* Stats */}
      {stats && (
        <Card>
          <CardHeader><span className="text-sm font-semibold text-white">Your Stats</span></CardHeader>
          <CardBody>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <div className="text-2xl font-bold text-amber-400">{stats.streak}</div>
                <div className="text-xs text-[#555A6A]">Day streak 🔥</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-blue-400">{stats.sessions}</div>
                <div className="text-xs text-[#555A6A]">Total sessions</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-emerald-400">{stats.best_score ?? '—'}/10</div>
                <div className="text-xs text-[#555A6A]">Best score</div>
              </div>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Usage (free) */}
      {isFree && (
        <Card className="p-5">
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm font-semibold text-white">AI Sessions</span>
            <span className="text-sm font-bold text-white">{aiUsed}{FREE_LIMIT ? ` / ${FREE_LIMIT}` : ''}</span>
          </div>
          <ProgressBar
            value={aiUsed}
            max={FREE_LIMIT ?? aiUsed + 1}
            barClassName={FREE_LIMIT && aiUsed >= FREE_LIMIT ? 'bg-red-400' : FREE_LIMIT && aiUsed >= FREE_LIMIT * 0.7 ? 'bg-amber-400' : 'bg-blue-500'}
            className="mb-2"
          />
          <p className="text-xs text-[#8B90A0]">
            {aiRemaining !== null && aiRemaining !== undefined
              ? aiRemaining > 0
                ? `${aiRemaining} session${aiRemaining !== 1 ? 's' : ''} remaining this month.`
                : 'All free sessions used.'
              : 'Check usage in your dashboard.'}
          </p>
        </Card>
      )}

      {/* Upgrade CTA (free users) */}
      {isFree && (
        <Card className="p-5 border-blue-500/20">
          <div className="text-sm font-bold text-white mb-1">🚀 Unlock unlimited practice</div>
          <p className="text-xs text-[#8B90A0] mb-4">
            Pro gives you unlimited AI sessions, full session history, advanced analytics, and HD voice.
          </p>
          <div className="space-y-2">
            <Button
              variant="upgrade"
              className="w-full"
              onClick={() => showUpgradeModal('strip')}
            >
              <Crown className="w-4 h-4" />
              Pro — ₹299/month
            </Button>
            <Button
              className="w-full bg-gradient-to-r from-purple-500 to-blue-500 hover:brightness-110 text-white"
              onClick={() => showUpgradeModal('strip')}
            >
              <Diamond className="w-4 h-4" />
              Elite — ₹599/month
            </Button>
          </div>
        </Card>
      )}

      {/* Plan features (pro/elite) */}
      {!isFree && (
        <Card className="p-5">
          <div className="text-sm font-semibold text-white mb-3">
            {user?.plan === 'elite' ? '◈ Elite Plan Active' : '✦ Pro Plan Active'}
          </div>
          <ul className="space-y-2 text-sm text-[#8B90A0]">
            <li className="flex items-center gap-2"><span className="text-emerald-400">✓</span> Unlimited AI interview sessions</li>
            <li className="flex items-center gap-2"><span className="text-emerald-400">✓</span> Full session history & progress tracking</li>
            <li className="flex items-center gap-2"><span className="text-emerald-400">✓</span> Advanced analytics & weak-area coaching</li>
            {user?.plan === 'elite' && (
              <li className="flex items-center gap-2"><span className="text-emerald-400">✓</span> Priority AI response speed</li>
            )}
          </ul>
        </Card>
      )}

      {/* Onboarding info */}
      {meData?.onboarding?.completed && (
        <Card className="p-5">
          <div className="text-sm font-semibold text-white mb-3">Your Goals</div>
          {meData.onboarding.profession && (
            <div className="flex justify-between text-sm mb-1">
              <span className="text-[#8B90A0]">Field</span>
              <span className="text-white">{meData.onboarding.profession}</span>
            </div>
          )}
          {meData.onboarding.goal && (
            <div className="flex justify-between text-sm">
              <span className="text-[#8B90A0]">Goal</span>
              <span className="text-white">{meData.onboarding.goal}</span>
            </div>
          )}
        </Card>
      )}

      {/* Member since */}
      {user?.created_at && (
        <p className="text-xs text-[#555A6A] text-center">
          Member since {formatDate(user.created_at)}
        </p>
      )}

      {/* Logout */}
      <Button
        variant="danger"
        className="w-full"
        onClick={handleLogout}
        loading={logout.isPending}
      >
        <LogOut className="w-4 h-4" />
        Sign Out
      </Button>
    </div>
  );
}
