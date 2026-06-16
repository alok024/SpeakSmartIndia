'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState , Suspense } from 'react';
import { useInterviewStore } from '@/store/interview';
import { useAuthStore } from '@/store/auth';
import { useUIStore } from '@/store/ui';
import { Button, Card, ChipGroup, Input } from '@/components/ui';
import { parseJsonArray } from '@/lib/utils';
import { Difficulty, InterviewType, Persona, SessionMode } from '@/types';

const PROFESSIONS = [
  'Software Developer', 'Java Developer', 'Government Job (SSC/UPSC)',
  'Data Scientist', 'Doctor / Medical', 'Teacher', 'Bank PO',
  'Marketing Manager', 'Full Stack Developer', 'Police / Defence',
];

const DIFFICULTIES: { label: string; value: Difficulty }[] = [
  { label: 'Beginner', value: 'beginner' },
  { label: 'Intermediate', value: 'intermediate' },
  { label: 'Expert', value: 'expert' },
];

const INTERVIEW_TYPES: { label: string; value: InterviewType }[] = [
  { label: 'Technical', value: 'Technical' },
  { label: 'Behavioral (HR)', value: 'Behavioral' },
  { label: 'Mixed', value: 'Mixed' },
];

const QUESTION_COUNTS = [
  { label: '3', value: '3' },
  { label: '5', value: '5' },
  { label: '8', value: '8' },
  { label: '10', value: '10' },
];

const TIMERS = [
  { label: 'No Timer', value: '0' },
  { label: '2 min', value: '120' },
  { label: '3 min', value: '180' },
  { label: '5 min', value: '300' },
];

function InterviewSetupPageInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { user } = useAuthStore();
  const { showUpgradeModal } = useUIStore();
  const store = useInterviewStore();

  const [customProfession, setCustomProfession] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);

  // Handle quick-start URL params
  useEffect(() => {
    const profession = params.get('profession');
    const mode = params.get('mode') as SessionMode | null;
    if (profession) store.setProfession(profession);
    if (mode) store.setMode(mode);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const isFree = !user || (user.plan !== 'pro' && user.plan !== 'elite');
  const aiCallsLeft = useAuthStore((s) => s.aiCallsLeft());
  const isLocked = isFree && aiCallsLeft <= 0;

  const selectedProfession = store.config.profession;

  function selectProfession(p: string) {
    store.setProfession(p);
    setCustomProfession('');
  }

  async function handleStart() {
    const profession = customProfession.trim() || selectedProfession;
    if (!profession) {
      setError('Please select or type a profession / field.');
      return;
    }
    setError('');
    setStarting(true);

    store.setProfession(profession);
    store.startSession();

    // Pre-generate questions for classic mode
    if (store.config.mode === 'classic') {
      router.push('/interview/session');
    } else {
      router.push('/interview/session');
    }
    setStarting(false);
  }

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto space-y-6">

      {/* Limit lock overlay */}
      {isLocked && (
        <Card className="p-6 text-center border-red-500/20">
          <div className="text-3xl mb-3">🔒</div>
          <h3 className="text-lg font-bold text-white mb-2">You've used all your free sessions</h3>
          <p className="text-sm text-[#8B90A0] mb-4">
            Upgrade to Pro for unlimited AI interviews, full history, and advanced analytics.
          </p>
          <Button variant="upgrade" onClick={() => showUpgradeModal('limit_hit')}>
            Upgrade to Pro — ₹299/month
          </Button>
        </Card>
      )}

      <div>
        <h1 className="text-2xl font-bold text-white">Set Up Your Interview</h1>
        <p className="text-sm text-[#8B90A0] mt-1">
          Choose your field and mode — AI Chat is the most realistic practice available.
        </p>
      </div>

      {/* Mode */}
      <Card className="p-5">
        <label className="block text-xs font-semibold uppercase tracking-widest text-[#8B90A0] mb-3">
          Interview Mode
        </label>
        <div className="grid grid-cols-2 gap-3">
          {[
            { value: 'classic', emoji: '📝', title: 'Classic Mode', desc: 'One question at a time. Detailed per-answer feedback with English corrections.' },
            { value: 'chat', emoji: '💬', title: 'AI Chat Mode', desc: 'Natural back-and-forth with an AI interviewer. Most realistic experience.' },
          ].map((m) => (
            <button
              key={m.value}
              onClick={() => store.setMode(m.value as SessionMode)}
              className={`p-4 rounded-xl border text-left transition-all ${
                store.config.mode === m.value
                  ? 'border-blue-500/50 bg-blue-500/10'
                  : 'border-white/[0.07] bg-[#1D2029] hover:border-white/[0.12]'
              }`}
            >
              <div className="text-2xl mb-2">{m.emoji}</div>
              <div className="text-sm font-semibold text-white mb-1">{m.title}</div>
              <div className="text-xs text-[#8B90A0] leading-snug">{m.desc}</div>
            </button>
          ))}
        </div>
      </Card>

      {/* Profession */}
      <Card className="p-5">
        <label className="block text-xs font-semibold uppercase tracking-widest text-[#8B90A0] mb-3">
          Profession / Field
        </label>
        <div className="flex flex-wrap gap-2 mb-3">
          {PROFESSIONS.map((p) => (
            <button
              key={p}
              onClick={() => selectProfession(p)}
              className={`px-3 py-2 rounded-full text-xs font-semibold border transition-all min-h-[36px] ${
                selectedProfession === p && !customProfession
                  ? 'bg-blue-500/20 border-blue-500/50 text-blue-400'
                  : 'bg-white/5 border-white/10 text-[#8B90A0] hover:text-white hover:border-white/20'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
        <Input
          placeholder="Or type any field — MBA, Nurse, IAS Officer, CA…"
          value={customProfession}
          onChange={(e) => setCustomProfession(e.target.value)}
        />
      </Card>

      {/* Difficulty */}
      <Card className="p-5">
        <label className="block text-xs font-semibold uppercase tracking-widest text-[#8B90A0] mb-3">
          Difficulty
        </label>
        <ChipGroup
          options={DIFFICULTIES}
          value={store.config.difficulty}
          onChange={(v) => store.setDifficulty(v)}
        />
      </Card>

      {/* Advanced options toggle */}
      <button
        onClick={() => setShowAdvanced(!showAdvanced)}
        className="text-sm text-[#8B90A0] hover:text-white transition-colors flex items-center gap-2"
      >
        <span className="text-xs">⚙</span>
        {showAdvanced ? 'Hide advanced options' : 'Show advanced options'}
      </button>

      {showAdvanced && (
        <div className="space-y-4">
          {/* Interview Type */}
          <Card className="p-5">
            <label className="block text-xs font-semibold uppercase tracking-widest text-[#8B90A0] mb-3">
              Interview Type
            </label>
            <ChipGroup
              options={INTERVIEW_TYPES}
              value={store.config.interviewType}
              onChange={(v) => store.setInterviewType(v)}
            />
          </Card>

          {/* Classic-only options */}
          {store.config.mode === 'classic' && (
            <>
              <Card className="p-5">
                <label className="block text-xs font-semibold uppercase tracking-widest text-[#8B90A0] mb-3">
                  Number of Questions
                </label>
                <ChipGroup
                  options={QUESTION_COUNTS}
                  value={String(store.config.totalQ)}
                  onChange={(v) => store.setTotalQ(Number(v))}
                />
              </Card>
              <Card className="p-5">
                <label className="block text-xs font-semibold uppercase tracking-widest text-[#8B90A0] mb-3">
                  Time per Question
                </label>
                <ChipGroup
                  options={TIMERS}
                  value={String(store.config.timerSecs)}
                  onChange={(v) => store.setTimerSecs(Number(v))}
                />
              </Card>
            </>
          )}

          {/* Language */}
          <Card className="p-5">
            <label className="block text-xs font-semibold uppercase tracking-widest text-[#8B90A0] mb-1">
              Interview Language
              <span className="ml-2 text-[9px] bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded px-1.5 py-0.5 normal-case tracking-normal">
                UNIQUE IN INDIA
              </span>
            </label>
            <p className="text-xs text-[#555A6A] mb-3">AI + voice input adapts to your chosen language</p>
            <div className="grid grid-cols-3 gap-2">
              {[
                { lang: 'en', flag: '🇬🇧', label: 'English' },
                { lang: 'hi', flag: '🇮🇳', label: 'हिंदी' },
                { lang: 'hinglish', flag: '🇮🇳', label: 'Hinglish' },
              ].map((l) => (
                <button
                  key={l.lang}
                  onClick={() => store.setLang(l.lang as 'en' | 'hi' | 'hinglish')}
                  className={`py-2.5 rounded-xl border text-center transition-all ${
                    store.config.lang === l.lang
                      ? 'border-blue-500/50 bg-blue-500/10'
                      : 'border-white/[0.07] bg-[#1D2029] hover:border-white/[0.12]'
                  }`}
                >
                  <div className="text-lg">{l.flag}</div>
                  <div className="text-xs text-white mt-1">{l.label}</div>
                </button>
              ))}
            </div>
          </Card>
        </div>
      )}

      {error && (
        <p className="text-sm text-red-400 bg-red-500/10 rounded-xl px-4 py-3">{error}</p>
      )}

      <Button
        size="xl"
        className="w-full shadow-[0_0_24px_rgba(79,142,247,0.3)]"
        loading={starting}
        disabled={isLocked}
        onClick={handleStart}
      >
        ▶ Start Interview
      </Button>
    </div>
  );
}

export default function InterviewSetupPage() {
  return (
    <Suspense fallback={<div />}>
      <InterviewSetupPageInner />
    </Suspense>
  );
}
