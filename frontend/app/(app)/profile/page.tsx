'use client';

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useMe, useLogout } from '@/hooks/queries';
import { useCompleteOnboarding, useDAF, useSaveDAF } from '@/features/user/hooks';
import { useAuthStore } from '@/store/auth';
import { useUIStore } from '@/store/ui';
import { Button, Card, CardHeader, CardBody, Badge, ProgressBar, Spinner } from '@/components/ui';
import type { BadgeVariant } from '@/components/ui';
import { formatDate, formatDateShort } from '@/lib/utils';
import { LogOut, Crown, Diamond, Zap } from 'lucide-react';
import { QK } from '@/lib/query-keys';
import { VoiceSettingsPanel } from '@/components/shared/VoiceSettingsPanel';
import { ElaraSettingsPanel } from '@/components/shared/ElaraSettingsPanel';

const PROFESSIONS = [
  'Software Engineering', 'Data Science / AI', 'Product Management', 'Business Analyst',
  'Marketing', 'Finance / Banking', 'HR / Recruiting', 'Sales', 'Operations', 'Other',
];

const GOALS = [
  'Get my first job', 'Switch companies', 'Get promoted', 'Improve confidence', 'Practice regularly',
];

// ─── DAF Section ──────────────────────────────────────────────────────────────
// UPSC Detailed Application Form. Only shown when the user's onboarding
// profession is in the Civil Services track. Saves on every explicit submit.

const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh',
  'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka',
  'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram',
  'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu',
  'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra & Nagar Haveli and Daman & Diu',
  'Delhi', 'Jammu & Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry',
];

const UPSC_OPTIONAL_SUBJECTS = [
  'Agriculture', 'Animal Husbandry & Veterinary Science', 'Anthropology',
  'Botany', 'Chemistry', 'Civil Engineering', 'Commerce & Accountancy',
  'Economics', 'Electrical Engineering', 'Geography', 'Geology',
  'History', 'Law', 'Management', 'Mathematics', 'Mechanical Engineering',
  'Medical Science', 'Philosophy', 'Physics', 'Political Science & International Relations',
  'Psychology', 'Public Administration', 'Sociology', 'Statistics', 'Zoology',
  'Literature (Assamese)', 'Literature (Bengali)', 'Literature (Bodo)', 'Literature (Dogri)',
  'Literature (Gujarati)', 'Literature (Hindi)', 'Literature (Kannada)',
  'Literature (Kashmiri)', 'Literature (Konkani)', 'Literature (Maithili)',
  'Literature (Malayalam)', 'Literature (Manipuri)', 'Literature (Marathi)',
  'Literature (Nepali)', 'Literature (Odia)', 'Literature (Punjabi)',
  'Literature (Sanskrit)', 'Literature (Santhali)', 'Literature (Sindhi)',
  'Literature (Tamil)', 'Literature (Telugu)', 'Literature (Urdu)',
];

interface DAFSectionProps {
  isUpscUser: boolean;
}

function DAFSection({ isUpscUser }: DAFSectionProps) {
  const { data: dafData, isLoading } = useDAF();
  const saveDAF = useSaveDAF();

  const [form, setForm] = useState({
    name:               '',
    home_state:         '',
    graduation_subject: '',
    graduation_college: '',
    optional_subject:   '',
    hobbies:            ['', '', ''] as [string, string, string],
    work_experience:    '',
    extracurriculars:   '',
  });
  const [initialised, setInitialised] = useState(false);
  const [saved, setSaved] = useState(false);

  // Pre-fill from fetched DAF data
  if (dafData && !initialised) {
    const hobbiesList = (dafData.hobbies ?? '').split(',').map((h: string) => h.trim());
    setForm({
      name:               dafData.name               ?? '',
      home_state:         dafData.home_state         ?? '',
      graduation_subject: dafData.graduation_subject ?? '',
      graduation_college: dafData.graduation_college ?? '',
      optional_subject:   dafData.optional_subject   ?? '',
      hobbies:            [hobbiesList[0] ?? '', hobbiesList[1] ?? '', hobbiesList[2] ?? ''],
      work_experience:    dafData.work_experience    ?? '',
      extracurriculars:   dafData.extracurriculars   ?? '',
    });
    setInitialised(true);
  }

  if (!isUpscUser) return null;

  async function handleSave() {
    const hobbiesStr = form.hobbies.filter(Boolean).join(', ');
    await saveDAF.mutateAsync({
      name:               form.name.trim()               || null,
      home_state:         form.home_state.trim()         || null,
      graduation_subject: form.graduation_subject.trim() || null,
      graduation_college: form.graduation_college.trim() || null,
      optional_subject:   form.optional_subject.trim()   || null,
      hobbies:            hobbiesStr                     || null,
      work_experience:    form.work_experience.trim()    || null,
      extracurriculars:   form.extracurriculars.trim()   || null,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  function field(key: keyof Omit<typeof form, 'hobbies'>) {
    return {
      value: form[key] as string,
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
        setForm(f => ({ ...f, [key]: e.target.value })),
    };
  }

  const inputStyle = {
    background: 'var(--surface-2)',
    borderColor: 'var(--border)',
    color: 'var(--text-1)',
  };

  const inputClass = 'w-full px-3 py-2 rounded-lg border text-sm focus:outline-none';

  if (isLoading) return null;

  return (
    <Card>
      <CardHeader>
        <span className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>
          🏛️ UPSC DAF Profile
        </span>
        <span
          className="ml-2 text-[9px] rounded px-1.5 py-0.5"
          style={{ background: 'var(--blue-dim)', color: 'var(--accent)', border: '1px solid var(--blue-border)' }}
        >
          PERSONALISED MOCK BOARD
        </span>
      </CardHeader>
      <CardBody className="space-y-4">
        <p className="text-xs font-medium" style={{ color: 'var(--text-3)' }}>
          Fill this once. Aria will use it to ask personalised questions exactly like a real UPSC board —
          your home state, optional subject, hobbies, and background all become part of the interview.
        </p>

        {/* Name */}
        <div>
          <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-3)' }}>
            Name (as on UPSC application)
          </label>
          <input className={inputClass} style={inputStyle} placeholder="Full name" {...field('name')} />
        </div>

        {/* Home State */}
        <div>
          <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-3)' }}>
            Home State / UT
          </label>
          <select className={inputClass} style={inputStyle} value={form.home_state}
            onChange={e => setForm(f => ({ ...f, home_state: e.target.value }))}>
            <option value="">Select state…</option>
            {INDIAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        {/* Graduation */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-3)' }}>
              Graduation Subject
            </label>
            <input className={inputClass} style={inputStyle} placeholder="e.g. Computer Science, History" {...field('graduation_subject')} />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-3)' }}>
              College / University
            </label>
            <input className={inputClass} style={inputStyle} placeholder="e.g. IIT Bombay, DU" {...field('graduation_college')} />
          </div>
        </div>

        {/* Optional Subject */}
        <div>
          <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-3)' }}>
            UPSC Optional Subject
          </label>
          <select className={inputClass} style={inputStyle} value={form.optional_subject}
            onChange={e => setForm(f => ({ ...f, optional_subject: e.target.value }))}>
            <option value="">Select optional…</option>
            {UPSC_OPTIONAL_SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        {/* Hobbies */}
        <div>
          <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-3)' }}>
            Hobbies (up to 3)
          </label>
          <div className="grid grid-cols-3 gap-2">
            {([0, 1, 2] as const).map(i => (
              <input
                key={i}
                className={inputClass}
                style={inputStyle}
                placeholder={`Hobby ${i + 1}`}
                value={form.hobbies[i]}
                onChange={e => {
                  const updated = [...form.hobbies] as [string, string, string];
                  updated[i] = e.target.value;
                  setForm(f => ({ ...f, hobbies: updated }));
                }}
              />
            ))}
          </div>
        </div>

        {/* Work Experience */}
        <div>
          <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-3)' }}>
            Work Experience (if any)
          </label>
          <textarea
            className={inputClass}
            style={inputStyle}
            rows={2}
            maxLength={500}
            placeholder="e.g. 2 years as Software Engineer at Infosys before appearing for UPSC"
            {...field('work_experience')}
          />
        </div>

        {/* Extra-curriculars */}
        <div>
          <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-3)' }}>
            Extra-curriculars / Achievements
          </label>
          <input
            className={inputClass}
            style={inputStyle}
            maxLength={300}
            placeholder="e.g. NCC A Certificate, State-level chess player, NSS volunteer"
            {...field('extracurriculars')}
          />
        </div>

        <Button
          onClick={handleSave}
          loading={saveDAF.isPending}
          disabled={saveDAF.isPending}
          className="w-full"
        >
          {saved ? '✓ DAF Saved' : 'Save DAF Profile'}
        </Button>
      </CardBody>
    </Card>
  );
}

function OnboardingForm({ onDone }: { onDone: () => void }) {
  const [profession, setProfession] = useState('');
  const [goal, setGoal] = useState('');
  const [error, setError] = useState('');
  const completeOnboarding = useCompleteOnboarding();

  async function handleSubmit() {
    if (!profession || !goal) { setError('Please select both a field and a goal.'); return; }
    setError('');
    const res = await completeOnboarding.mutateAsync({ profession, goal });
    if (res.ok) onDone();
    else setError('Something went wrong. Please try again.');
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'var(--bg)' }}>
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <div className="text-3xl mb-2">👋</div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-1)' }}>Welcome to Vachix</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-3)' }}>Tell us about yourself so we can personalise your practice.</p>
        </div>

        <Card className="p-5">
          <div className="text-sm font-semibold mb-3" style={{ color: 'var(--text-1)' }}>What's your field?</div>
          <div className="grid grid-cols-2 gap-2">
            {PROFESSIONS.map((p) => (
              <button
                key={p}
                onClick={() => setProfession(p)}
                className="text-sm px-3 py-2 rounded-lg border transition-all text-left"
                style={profession === p
                  ? { borderColor: 'var(--accent-border)', background: 'var(--accent-dim)', color: 'var(--text-1)' }
                  : { borderColor: 'var(--border)', background: 'transparent', color: 'var(--text-2)' }}
              >
                {p}
              </button>
            ))}
          </div>
        </Card>

        <Card className="p-5">
          <div className="text-sm font-semibold mb-3" style={{ color: 'var(--text-1)' }}>What's your main goal?</div>
          <div className="space-y-2">
            {GOALS.map((g) => (
              <button
                key={g}
                onClick={() => setGoal(g)}
                className="w-full text-sm px-4 py-2.5 rounded-lg border transition-all text-left"
                style={goal === g
                  ? { borderColor: 'var(--accent-border)', background: 'var(--accent-dim)', color: 'var(--text-1)' }
                  : { borderColor: 'var(--border)', background: 'transparent', color: 'var(--text-2)' }}
              >
                {g}
              </button>
            ))}
          </div>
        </Card>

        {error && <p className="text-xs text-center" style={{ color: 'var(--error)' }}>{error}</p>}

        <Button className="w-full" onClick={handleSubmit} loading={completeOnboarding.isPending} disabled={!profession || !goal}>
          Get Started →
        </Button>
      </div>
    </div>
  );
}

function ProfilePageInner() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const qc           = useQueryClient();
  const { user }     = useAuthStore();
  const { showUpgradeModal } = useUIStore();
  const { data: meData, isLoading } = useMe();
  const logout       = useLogout();

  const isOnboarding = searchParams.get('onboarding') === '1' && !meData?.onboarding?.completed;
  const stats        = meData?.stats;
  const usage        = meData?.usage;
  const isFree       = !user || (user.plan === 'free');
  const isStarter    = user?.plan === 'starter';
  const isProOrElite = user?.plan === 'pro' || user?.plan === 'elite';
  // Starter shares Free's finite, trackable session cap (30/month) —
  // unlike Pro/Elite, which are unlimited — so both should see the usage
  // bar and an upsell CTA. Only Pro/Elite are truly "unlimited, nothing
  // more to show usage for".
  const hasUsageCap  = isFree || isStarter;
  const FREE_LIMIT   = usage?.limit ?? user?.ai_calls_limit ?? null;
  const aiUsed       = usage?.ai_calls ?? 0;
  const aiRemaining  = usage?.remaining ?? user?.ai_calls_remaining ?? null;

  const planLabel        = user?.plan === 'elite' ? '◈ Elite' : user?.plan === 'pro' ? '✦ Pro' : user?.plan === 'starter' ? '⚡ Starter' : 'Free';
  const planBadgeVariant: BadgeVariant = user?.plan === 'elite' ? 'elite' : user?.plan === 'pro' ? 'pro' : user?.plan === 'starter' ? 'starter' : 'free';

  async function handleLogout() {
    await logout.mutateAsync();
    qc.clear();
    router.push('/login');
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner size={28} style={{ color: 'var(--accent)' }} />
      </div>
    );
  }

  if (isOnboarding) return <OnboardingForm onDone={() => { qc.invalidateQueries({ queryKey: QK.me }); router.replace('/dashboard'); }} />;

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto space-y-5">
      <h1 className="text-2xl font-bold" style={{ color: 'var(--text-1)' }}>Profile & Plan</h1>

      {/* User card */}
      <Card className="p-5">
        <div className="flex items-center gap-4">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center text-xl font-bold"
            style={{ background: 'var(--blue)', color: '#fff' }}
          >
            {(user?.name?.[0] ?? user?.email?.[0] ?? '?').toUpperCase()}
          </div>
          <div>
            <div className="text-lg font-bold" style={{ color: 'var(--text-1)' }}>{user?.name ?? '—'}</div>
            <div className="text-sm" style={{ color: 'var(--text-3)' }}>{user?.email}</div>
            <Badge variant={planBadgeVariant} className="mt-1">{planLabel} Plan</Badge>
          </div>
        </div>
      </Card>

      {/* Stats */}
      {stats && (
        <Card>
          <CardHeader><span className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>Your Stats</span></CardHeader>
          <CardBody>
            <div className="grid grid-cols-3 gap-4 text-center">
              {[
                { value: stats.streak, sub: 'Day streak 🔥', color: 'var(--warn)' },
                { value: stats.sessions, sub: 'Sessions', color: 'var(--accent)' },
                { value: `${stats.best_score ?? '—'}/10`, sub: 'Best score', color: 'var(--success)' },
              ].map((s, i) => (
                <div key={i}>
                  <div className="text-2xl font-bold tabular-nums" style={{ color: s.color }}>{s.value}</div>
                  <div className="text-xs font-medium" style={{ color: 'var(--text-3)' }}>{s.sub}</div>
                </div>
              ))}
            </div>
            {(stats.xp_lifetime ?? 0) > 0 && (
              <div className="mt-4 pt-4 flex items-center justify-between" style={{ borderTop: '1px solid var(--border)' }}>
                <div>
                  <div className="text-xs font-medium" style={{ color: 'var(--text-3)' }}>Lifetime XP</div>
                  <div className="text-xl font-bold tabular-nums" style={{ color: 'var(--accent)' }}>⚡ {stats.xp_lifetime?.toLocaleString('en-IN')}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs font-medium" style={{ color: 'var(--text-3)' }}>This Month</div>
                  <div className="text-xl font-bold tabular-nums" style={{ color: 'var(--warn)' }}>{stats.xp_monthly?.toLocaleString('en-IN')} XP</div>
                </div>
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {/* Usage — anyone with a finite session cap (Free, Starter) */}
      {hasUsageCap && (
        <Card className="p-5">
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>AI Sessions</span>
            <span className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>{aiUsed}{FREE_LIMIT ? ` / ${FREE_LIMIT}` : ''}</span>
          </div>
          <ProgressBar
            value={aiUsed}
            max={FREE_LIMIT ?? aiUsed + 1}
            color={FREE_LIMIT && aiUsed >= FREE_LIMIT ? 'var(--error)' : FREE_LIMIT && aiUsed >= FREE_LIMIT * 0.7 ? 'var(--warn)' : 'var(--accent)'}
            animated
            className="mb-2"
          />
          <p className="text-xs font-medium" style={{ color: 'var(--text-3)' }}>
            {aiRemaining != null
              ? aiRemaining > 0 ? `${aiRemaining} session${aiRemaining !== 1 ? 's' : ''} remaining.` : 'All sessions used for this period.'
              : 'Check usage in your dashboard.'}
          </p>
        </Card>
      )}

      {/* Upgrade CTA — free users see Starter + Pro + Elite; Starter users see Pro + Elite */}
      {hasUsageCap && (
        <Card className="p-5" style={{ borderColor: 'var(--blue-border)' }}>
          <div className="text-sm font-bold mb-1" style={{ color: 'var(--text-1)' }}>🚀 Unlock unlimited practice</div>
          <p className="text-xs mb-4 font-medium" style={{ color: 'var(--text-3)' }}>
            {isStarter
              ? 'Upgrade to Pro for unlimited AI sessions, full session history, and HD voice.'
              : 'Choose a plan to get more sessions, HD voice, and advanced analytics.'}
          </p>
          <div className="space-y-2">
            {/* Starter option — only shown to Free users */}
            {isFree && (
              <Button variant="upgrade" className="w-full" onClick={() => showUpgradeModal('strip')}>
                <Zap className="w-4 h-4" />
                Starter — ₹299/month
              </Button>
            )}
            <Button variant="upgrade" className="w-full" onClick={() => showUpgradeModal('strip')}>
              <Crown className="w-4 h-4" />
              Pro — ₹699/month
            </Button>
            <Button variant="upgrade" className="w-full" onClick={() => showUpgradeModal('strip')}>
              <Diamond className="w-4 h-4" />
              Elite — ₹1,299/month
            </Button>
          </div>
        </Card>
      )}

      {/* Starter plan — active features, accurate to what Starter actually includes */}
      {isStarter && (
        <Card className="p-5">
          <div className="text-sm font-semibold mb-3" style={{ color: 'var(--text-1)' }}>⚡ Starter Plan Active</div>
          <ul className="space-y-2 text-sm" style={{ color: 'var(--text-2)' }}>
            {['30 AI interview sessions/month', 'All 11 exam tracks', 'Elara English correction', 'Grammar & Fluency scoring', 'AI memory on your mistakes', 'HD voice — 10 min/month'].map((f) => (
              <li key={f} className="flex items-center gap-2">
                <span style={{ color: 'var(--success)' }}>✓</span> {f}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Pro/Elite features */}
      {isProOrElite && (
        <Card className="p-5">
          <div className="text-sm font-semibold mb-3" style={{ color: 'var(--text-1)' }}>
            {user?.plan === 'elite' ? '◈ Elite Plan Active' : '✦ Pro Plan Active'}
          </div>
          <ul className="space-y-2 text-sm" style={{ color: 'var(--text-2)' }}>
            {['Unlimited AI interview sessions', 'Full session history & progress tracking', 'Advanced analytics & weak-area coaching']
              .concat(user?.plan === 'elite' ? ['Priority AI response speed'] : [])
              .map((f) => (
                <li key={f} className="flex items-center gap-2">
                  <span style={{ color: 'var(--success)' }}>✓</span> {f}
                </li>
              ))}
          </ul>
        </Card>
      )}

      {/* Billing — renewal date + cancel instructions for paid users */}
      {!isFree && meData?.subscription && (
        <Card className="p-5">
          <div className="text-sm font-semibold mb-3" style={{ color: 'var(--text-1)' }}>
            Billing
          </div>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span style={{ color: 'var(--text-3)' }}>Plan</span>
              <span style={{ color: 'var(--text-1)', fontWeight: 500, textTransform: 'capitalize' }}>
                {meData.subscription.plan}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span style={{ color: 'var(--text-3)' }}>Renews on</span>
              <span style={{ color: 'var(--text-1)' }}>
                {formatDate(meData.subscription.expires_at)}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span style={{ color: 'var(--text-3)' }}>Billed</span>
              <span style={{ color: 'var(--text-2)' }}>Monthly + 18% GST via Razorpay</span>
            </div>
          </div>

          {/* Cancel instructions — no in-app cancel button intentionally.
              Razorpay one-time orders don't support programmatic cancel;
              the subscription expires at period end anyway. We show clear
              instructions so users aren't confused. */}
          <div
            className="mt-4 p-3 rounded-xl text-xs leading-relaxed"
            style={{
              background: 'var(--surface-2)',
              color: 'var(--text-3)',
              border: '1px solid var(--border)',
            }}
          >
            <span style={{ color: 'var(--text-2)', fontWeight: 500 }}>To cancel:</span>{' '}
            Your plan does not auto-renew — each billing period is a one-time payment via
            Razorpay. Simply do not repurchase when your current period ends on{' '}
            <span style={{ color: 'var(--text-2)' }}>
              {formatDate(meData.subscription.expires_at)}
            </span>
            . You keep full access until that date. No hidden fees, no cancellation needed.{' '}
            Questions?{' '}
            <a
              href="mailto:support@vachix.in?subject=Billing%20question"
              style={{ color: 'var(--accent)', textDecoration: 'none' }}
            >
              Email us →
            </a>
          </div>
        </Card>
      )}

      {/* Goals */}
      {meData?.onboarding?.completed && (
        <Card className="p-5">
          <div className="text-sm font-semibold mb-3" style={{ color: 'var(--text-1)' }}>Your Goals</div>
          {meData.onboarding.profession && (
            <div className="flex justify-between text-sm mb-1">
              <span style={{ color: 'var(--text-3)' }}>Field</span>
              <span style={{ color: 'var(--text-1)' }}>{meData.onboarding.profession}</span>
            </div>
          )}
          {meData.onboarding.goal && (
            <div className="flex justify-between text-sm">
              <span style={{ color: 'var(--text-3)' }}>Goal</span>
              <span style={{ color: 'var(--text-1)' }}>{meData.onboarding.goal}</span>
            </div>
          )}
        </Card>
      )}

      {user?.created_at && (
        <p className="text-xs text-center font-medium" style={{ color: 'var(--text-3)' }}>
          Member since {formatDate(user.created_at)}
        </p>
      )}

      <VoiceSettingsPanel user={user ?? null} />
      <ElaraSettingsPanel user={user ?? null} />

      {/* DAF — shown for UPSC/Civil Services users only */}
      <DAFSection
        isUpscUser={
          !!(
            meData?.onboarding?.profession?.toLowerCase().includes('upsc') ||
            meData?.onboarding?.profession?.toLowerCase().includes('civil service') ||
            meData?.onboarding?.profession?.toLowerCase().includes('ias') ||
            meData?.onboarding?.profession?.toLowerCase().includes('ips')
          )
        }
      />

      <Button variant="danger" className="w-full" onClick={handleLogout} loading={logout.isPending}>
        <LogOut className="w-4 h-4" /> Sign Out
      </Button>
    </div>
  );
}

export default function ProfilePage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-64">
        <Spinner size={28} style={{ color: 'var(--accent)' }} />
      </div>
    }>
      <ProfilePageInner />
    </Suspense>
  );
}
