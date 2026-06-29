'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, useRef, Suspense } from 'react';
import { useInterviewStore } from '@/store/interview';
import { useAuthStore } from '@/store/auth';
import { useUIStore } from '@/store/ui';
import { useMe } from '@/features/user/hooks';
import { useSaveCompanyMode } from '@/features/user/hooks';
import { Button, Card, ChipGroup, Input } from '@/components/ui';
import { Difficulty, InterviewType, SessionMode } from '@/types';
import { voiceApi } from '@/features/voice/api';
import { FLAG } from '@/lib/feature-flags';
import { TRACKS } from '@/lib/interview-prompts';

// Tracks that support company-specific campus mode
const COMPANY_MODE_TRACKS = new Set([
  'Software Developer',
  'Full Stack Developer',
  'Data Scientist',
]);

const COMPANY_MODES: {
  id: 'tcs' | 'infosys' | 'wipro' | 'accenture' | 'amazon' | 'google' | 'flipkart';
  label: string;
  icon: string;
  hint: string;
}[] = [
  { id: 'tcs',       label: 'TCS',       icon: '🔷', hint: 'Values-based + technical basics' },
  { id: 'infosys',   label: 'Infosys',   icon: '🔵', hint: 'InfyTQ style — aptitude + OOP' },
  { id: 'wipro',     label: 'Wipro',     icon: '💡', hint: 'WILP/WASE pattern' },
  { id: 'accenture', label: 'Accenture', icon: '🟣', hint: 'Communication + behavioral heavy' },
  { id: 'amazon',    label: 'Amazon',    icon: '📦', hint: 'All 16 Leadership Principles — STAR' },
  { id: 'google',    label: 'Google',    icon: '🔴', hint: 'Googleyness + structured problem-solving' },
  { id: 'flipkart',  label: 'Flipkart',  icon: '🛒', hint: 'Product sense + ops scenarios' },
];

// Derive a flat ordered list of track names for the picker
const TRACK_NAMES = Object.keys(TRACKS);

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
  { label: '3', value: '3' }, { label: '5', value: '5' },
  { label: '8', value: '8' }, { label: '10', value: '10' },
];

const TIMERS = [
  { label: 'No Timer', value: '0' }, { label: '2 min', value: '120' },
  { label: '3 min', value: '180' },  { label: '5 min', value: '300' },
];

// Voice "warm-up" One short line per language so the
// preview button actually demonstrates the language it's previewing.
const VOICE_PREVIEW_SAMPLES: Record<'en' | 'hi' | 'hinglish', string> = {
  en:       "Tell me about a time you handled a challenging situation at work.",
  hi:       "मुझे बताइए कि आपने काम के दौरान किसी मुश्किल स्थिति को कैसे संभाला।",
  hinglish: "Apna experience batao ek challenging situation ke baare mein jo aapne kaam ke dauran handle ki.",
};

// Live preview builder
function buildLivePreview(
  profession: string | null,
  difficulty: Difficulty | null,
  interviewType: InterviewType | null,
  totalQ: number | null,
): { line1: string; line2: string } | null {
  if (!profession) return null;
  const qStr = totalQ ? `${totalQ} questions` : '? questions';
  const line1 = [
    `Your session will have ${qStr} for`,
    profession,
    difficulty ? `· ${difficulty}` : '',
    interviewType ? `· ${interviewType}` : '',
  ].filter(Boolean).join(' ');

  let line2 = '';
  if (profession && difficulty && interviewType && totalQ) {
    const mins: Record<number, number> = { 3: 8, 5: 12, 8: 18, 10: 25 };
    line2 = `Estimated duration: ~${mins[totalQ] ?? 12} min. Aria will evaluate each answer instantly.`;
  } else {
    const missing: string[] = [];
    if (!difficulty) missing.push('difficulty');
    if (!interviewType) missing.push('question type');
    if (!totalQ) missing.push('question count');
    if (missing.length) line2 = `Still need: ${missing.join(', ')}.`;
  }
  return { line1, line2 };
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--text-3)' }}>
      {children}
    </label>
  );
}

// Step indicator component
function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-0 mb-6">
      {Array.from({ length: total }).map((_, i) => (
        <div key={i} className="flex items-center flex-1 last:flex-none">
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 transition-all duration-300 z-10"
            style={{
              background: i < current ? 'var(--accent)' : i === current ? 'var(--accent)' : 'var(--surface-2)',
              border: `1.5px solid ${i <= current ? 'var(--accent)' : 'var(--border2)'}`,
              color: i <= current ? '#fff' : 'var(--text-2)',
              boxShadow: i === current ? '0 0 0 3px var(--accent-dim)' : 'none',
            }}
          >
            {i < current ? '✓' : i + 1}
          </div>
          {i < total - 1 && (
            <div
              className="flex-1 h-px mx-1 transition-all duration-500"
              style={{ background: i < current ? 'var(--accent)' : 'var(--border2)' }}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function InterviewSetupPageInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { user } = useAuthStore();
  const { showUpgradeModal } = useUIStore();
  const { data: meData } = useMe();
  const store = useInterviewStore();
  const saveCompanyMode = useSaveCompanyMode();

  // Multi-step state
  const [step, setStep] = useState(0); // 0=track, 1=topics, 2=style, 3=review+start
  const [slideDir, setSlideDir] = useState<'forward' | 'back'>('forward');

  function goToStep(n: number) {
    setSlideDir(n > step ? 'forward' : 'back');
    setStep(n);
  }

  // Local topic selection — synced to store on each navigation forward
  const [localTopics, setLocalTopics] = useState<string[]>([]);

  function toggleTopic(topic: string) {
    setLocalTopics((prev) =>
      prev.includes(topic) ? prev.filter((t) => t !== topic) : [...prev, topic],
    );
  }

  const [customProfession, setCustomProfession] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showJd, setShowJd] = useState(false);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewMsg, setPreviewMsg] = useState<string | null>(null);
  const [hasPreviewedToday, setHasPreviewedToday] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Auto-detect low-end devices and default to voice-only mode.
  useEffect(() => {
    if (useInterviewStore.getState().config.avatarMode !== undefined) return;
    if (typeof window === 'undefined') return;
    const nav = navigator as Navigator & {
      deviceMemory?: number;
      connection?: { effectiveType?: string };
    };
    const isLowMemory  = (nav.deviceMemory ?? Infinity) < 2;
    const isSlow2G     = nav.connection?.effectiveType === '2g';
    if (isLowMemory || isSlow2G) useInterviewStore.getState().setAvatarMode('voice-only');
  }, []);

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        URL.revokeObjectURL(audioRef.current.src);
      }
    };
  }, []);

  useEffect(() => {
    const profession = params.get('profession');
    const mode = params.get('mode') as SessionMode | null;
    const difficulty = params.get('difficulty') as Difficulty | null;
    const interviewType = params.get('interview_type') as InterviewType | null;
    const s = useInterviewStore.getState();
    if (profession) s.setProfession(profession);
    if (mode) s.setMode(mode);
    if (difficulty) s.setDifficulty(difficulty);
    if (interviewType) s.setInterviewType(interviewType);
  }, [params]);

  useEffect(() => {
    if (!meData?.session_defaults) return;
    if (params.get('profession')) return;
    if (useInterviewStore.getState().config.profession) return;
    const { profession, difficulty, interview_type } = meData.session_defaults;
    const s = useInterviewStore.getState();
    if (profession) s.setProfession(profession);
    if (difficulty) s.setDifficulty(difficulty as Difficulty);
    if (interview_type) s.setInterviewType(interview_type as InterviewType);
  }, [meData?.session_defaults, params]);

  const livePlan    = meData?.user?.plan ?? user?.plan;
  const isFree      = !livePlan || (livePlan !== 'pro' && livePlan !== 'elite');
  const hasVoiceQuota = livePlan === 'starter' || livePlan === 'pro' || livePlan === 'elite';
  const aiCallsLeft = useAuthStore((s) => s.aiCallsLeft());

  const sessionCount = meData?.usage?.session_count ?? 0;
  const sessionLimit = meData?.usage?.session_limit ?? null;
  const isFreeSessionCapReached = isFree && sessionLimit !== null && sessionCount >= sessionLimit;

  const isLocked = isFree && (aiCallsLeft <= 0 || isFreeSessionCapReached);
  const selectedProfession = store.config.profession;

  function selectTrack(trackName: string) {
    const track = TRACKS[trackName];
    if (!track) return;
    store.setProfession(track.profession);
    setCustomProfession('');
    // Reset topics when track changes — topics are track-specific
    setLocalTopics([]);
    store.setSelectedTopics([]);
    // Company mode only applies to SDE/Full Stack/Data Scientist tracks.
    // Clear any previously-selected company so it doesn't silently persist
    // (in local state AND on the server) into an unrelated track's
    // sessions — e.g. an Amazon LP selection bleeding into a UPSC session.
    if (!COMPANY_MODE_TRACKS.has(trackName) && store.config.companyMode) {
      store.setCompanyMode(null);
      saveCompanyMode.mutate(null);
    }
  }

  // The track name the user picked (reverse-lookup by profession string)
  const selectedTrackName =
    TRACK_NAMES.find((name) => TRACKS[name].profession === selectedProfession) ?? null;

  async function playVoicePreview() {
    if (previewLoading) return;
    setPreviewLoading(true);
    setPreviewMsg(null);
    const sample = VOICE_PREVIEW_SAMPLES[store.config.lang];
    if (!hasVoiceQuota && hasPreviewedToday && audioRef.current && audioRef.current.dataset.lang === store.config.lang) {
      setPreviewLoading(false);
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(() => {});
      return;
    }
    if (!hasVoiceQuota) {
      const result = await voiceApi.ttsWarmup(sample);
      setPreviewLoading(false);
      if (!result.ok) {
        if (result.reason === 'already_used_today') {
          setPreviewMsg("You've already used today's free preview — upgrade to Pro for unlimited HD voice, or come back tomorrow.");
        } else if (result.reason === 'not_configured') {
          setPreviewMsg('Voice preview is temporarily unavailable.');
        } else {
          setPreviewMsg('Could not play preview — please try again.');
        }
        return;
      }
      setHasPreviewedToday(true);
      playBlob(result.blob, store.config.lang);
      return;
    }
    const blob = await voiceApi.tts(sample, store.config.lang);
    setPreviewLoading(false);
    if (!blob) {
      setPreviewMsg('Could not play preview — please try again.');
      return;
    }
    playBlob(blob, store.config.lang);
  }

  function playBlob(blob: Blob, lang: string) {
    if (audioRef.current) {
      audioRef.current.pause();
      URL.revokeObjectURL(audioRef.current.src);
    }
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.dataset.lang = lang;
    audioRef.current = audio;
    audio.play().catch(() => setPreviewMsg('Could not play preview — please try again.'));
  }

  async function handleStart() {
    if (isLocked) { showUpgradeModal('limit_hit'); return; }
    const profession = customProfession.trim() || selectedProfession;
    if (!profession) { setError('Please select a track or type a profession / field.'); return; }
    setError('');
    setStarting(true);
    store.setProfession(profession);
    // Ensure the latest topic selection is committed to the store before the
    // session page reads config. (User may have edited topics then gone straight
    // to Start without triggering the Topics → Style forward navigation.)
    store.setSelectedTopics(localTopics);
    store.startSession();
    router.push('/interview/session');
    setStarting(false);
  }

  // Live preview
  const livePreview = buildLivePreview(
    customProfession.trim() || selectedProfession || null,
    store.config.difficulty ?? null,
    store.config.interviewType ?? null,
    store.config.totalQ ?? null,
  );

  // Step 0 complete: a track is picked (via card) or custom text entered
  const step0Complete = !!(customProfession.trim() || selectedProfession);
  // Step 1 (topics) complete: at least one topic selected, or user typed a custom profession
  const step1Complete = localTopics.length > 0 || !!customProfession.trim() || !selectedTrackName;
  // Step 2 complete when difficulty + type + count are set
  const step2Complete = !!(store.config.difficulty && store.config.interviewType && store.config.totalQ);
  // Legacy alias used by CTA / review step
  const allStepsComplete = step0Complete && step2Complete;

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto space-y-6">

      {isLocked && (
        <Card className="p-6 text-center" style={{ borderColor: 'var(--error-border)' }}>
          <div className="text-3xl mb-3">🔒</div>
          <h3 className="text-lg font-bold mb-2" style={{ color: 'var(--text-1)' }}>
            {isFreeSessionCapReached
              ? `You've used all ${sessionLimit} free sessions this month`
              : "You've used all your free AI calls this month"}
          </h3>
          <p className="text-sm mb-4" style={{ color: 'var(--text-3)' }}>
            {meData?.usage?.resets_at
              ? `Your sessions reset on ${new Date(meData.usage.resets_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'long' })}.`
              : 'Your sessions reset at the start of next month.'
            }{' '}
            Upgrade to Pro for unlimited AI interviews, full history, and advanced analytics.
          </p>
          <Button variant="upgrade" onClick={() => showUpgradeModal('limit_hit')}>
            Upgrade to Pro — ₹699/month
          </Button>
        </Card>
      )}

      <div>
        <h1 className="text-2xl font-bold" style={{ color: 'var(--text-1)' }}>Set Up Your Interview</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-3)' }}>
          Choose your field and mode — AI Chat is the most realistic practice available.
        </p>
      </div>

      {/* Step indicator */}
      <StepIndicator current={step} total={4} />

      {/* Step 0: Track picker */}
      {step === 0 && (
        <div
          key={step}
          className="space-y-5"
          style={{
            animation: slideDir === 'forward'
              ? 'slideInRight 0.28s cubic-bezier(.22,.68,0,1.2) both'
              : 'slideInLeft 0.28s cubic-bezier(.22,.68,0,1.2) both',
          }}
        >
          <Card className="p-5">
            <SectionLabel>Choose Your Track (25 available)</SectionLabel>
            <div
              className="grid gap-3 mb-4"
              style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))' }}
            >
              {TRACK_NAMES.map((trackName) => {
                const track = TRACKS[trackName];
                const isSelected = selectedTrackName === trackName && !customProfession;
                return (
                  <button
                    key={trackName}
                    onClick={() => selectTrack(trackName)}
                    className="relative rounded-2xl p-3 flex flex-col items-center gap-1 text-center cursor-pointer transition-all duration-200 border"
                    style={{
                      background: isSelected ? 'var(--accent-dim)' : 'var(--surface-2)',
                      borderColor: isSelected ? 'var(--accent-border)' : 'var(--border2)',
                      transform: isSelected ? 'translateY(-2px)' : 'none',
                      boxShadow: isSelected ? '0 4px 16px rgba(var(--accent-rgb, 99,102,241),.18)' : 'none',
                    }}
                  >
                    <span
                      className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold transition-all duration-200"
                      style={{
                        background: isSelected ? 'var(--accent)' : 'transparent',
                        color: '#fff',
                        opacity: isSelected ? 1 : 0,
                        transform: isSelected ? 'scale(1)' : 'scale(0)',
                      }}
                    >
                      ✓
                    </span>
                    <div className="text-xl">{track.icon}</div>
                    <div className="text-[11px] font-semibold leading-tight" style={{ color: 'var(--text-1)' }}>{trackName}</div>
                    <div className="text-[10px] font-medium leading-snug" style={{ color: 'var(--text-3)' }}>{track.hint}</div>
                  </button>
                );
              })}
            </div>
            <Input
              placeholder="Or type any field — MBA, Nurse, IAS Officer, CA…"
              value={customProfession}
              onChange={(e) => {
                setCustomProfession(e.target.value);
                if (e.target.value) {
                  store.setProfession(e.target.value.trim());
                  setLocalTopics([]);
                  store.setSelectedTopics([]);
                  // Custom/free-typed profession is never a company-mode
                  // track in the UI — clear any stale selection so it
                  // doesn't persist into this (or a later) session.
                  if (store.config.companyMode) {
                    store.setCompanyMode(null);
                    saveCompanyMode.mutate(null);
                  }
                }
              }}
            />
          </Card>

          {/* Mode */}
          <Card className="p-5">
            <SectionLabel>Interview Mode</SectionLabel>
            <div className="grid grid-cols-2 gap-3">
              {[
                { value: 'classic', emoji: '📝', title: 'Classic Mode', desc: 'One question at a time. Detailed per-answer feedback with English corrections.' },
                { value: 'chat',    emoji: '💬', title: 'AI Chat Mode', desc: 'Natural back-and-forth with an AI interviewer. Most realistic experience.' },
              ].map((m) => {
                const isActive = store.config.mode === m.value;
                return (
                  <button
                    key={m.value}
                    onClick={() => store.setMode(m.value as SessionMode)}
                    className="p-4 rounded-xl border text-left transition-all duration-200"
                    style={isActive
                      ? { borderColor: 'var(--accent-border)', background: 'var(--accent-dim)' }
                      : { borderColor: 'var(--border)', background: 'var(--surface-2)' }}
                  >
                    <div className="text-2xl mb-2">{m.emoji}</div>
                    <div className="text-sm font-semibold mb-1" style={{ color: 'var(--text-1)' }}>{m.title}</div>
                    <div className="text-xs leading-snug font-medium" style={{ color: 'var(--text-3)' }}>{m.desc}</div>
                  </button>
                );
              })}
            </div>
          </Card>

          {/* Company Mode — campus-specific interview pattern */}
          {selectedTrackName && COMPANY_MODE_TRACKS.has(selectedTrackName) && (
            <Card className="p-5">
              <SectionLabel>
                Company Mode{' '}
                <span
                  className="ml-1 text-[9px] rounded px-1.5 py-0.5 normal-case tracking-normal"
                  style={{ background: 'var(--blue-dim)', color: 'var(--accent)', border: '1px solid var(--blue-border)' }}
                >
                  OPTIONAL
                </span>
              </SectionLabel>
              <p className="text-xs mb-3 font-medium" style={{ color: 'var(--text-3)' }}>
                Select a company to simulate their exact interview format. Aria's questions shift to match — Amazon LP rounds, Google Googleyness, TCS values, and more.
              </p>
              <div className="grid grid-cols-2 gap-2">
                {COMPANY_MODES.map((c) => {
                  const isActive = store.config.companyMode === c.id;
                  return (
                    <button
                      key={c.id}
                      onClick={() => {
                        const next = isActive ? null : c.id;
                        store.setCompanyMode(next);
                        saveCompanyMode.mutate(next);
                      }}
                      className="p-3 rounded-xl border text-left transition-all duration-200"
                      style={isActive
                        ? { borderColor: 'var(--accent-border)', background: 'var(--accent-dim)' }
                        : { borderColor: 'var(--border)', background: 'var(--surface-2)' }}
                    >
                      <div className="text-lg">{c.icon}</div>
                      <div className="text-xs font-bold mt-1" style={{ color: 'var(--text-1)' }}>{c.label}</div>
                      <div className="text-[10px] font-medium leading-snug mt-0.5" style={{ color: 'var(--text-3)' }}>{c.hint}</div>
                    </button>
                  );
                })}
              </div>
              {store.config.companyMode && (
                <button
                  className="text-xs mt-3 underline transition-colors"
                  style={{ color: 'var(--text-3)' }}
                  onClick={() => { store.setCompanyMode(null); saveCompanyMode.mutate(null); }}
                >
                  Clear — use generic prep
                </button>
              )}
            </Card>
          )}

          {/* Step 0 → Step 1 (Topics) */}
          <div className="flex justify-end">
            <Button
              disabled={!step0Complete}
              onClick={() => goToStep(1)}
            >
              Pick Topics →
            </Button>
          </div>
        </div>
      )}

      {/* Step 1: Topic Buckets */}
      {step === 1 && (() => {
        const activeBuckets = selectedTrackName ? TRACKS[selectedTrackName].topics : [];
        return (
          <div
            key={step}
            className="space-y-4"
            style={{
              animation: slideDir === 'forward'
                ? 'slideInRight 0.28s cubic-bezier(.22,.68,0,1.2) both'
                : 'slideInLeft 0.28s cubic-bezier(.22,.68,0,1.2) both',
            }}
          >
            <Card className="p-5">
              <SectionLabel>
                {selectedTrackName ? `Pick Topic Buckets — ${selectedTrackName}` : 'Topic Focus'}
              </SectionLabel>
              {activeBuckets.length > 0 ? (
                <>
                  <p className="text-xs mb-4" style={{ color: 'var(--text-3)' }}>
                    Select one or more to keep your practice targeted. Aria will only draw questions from these areas.
                  </p>
                  <div className="flex flex-wrap gap-2 mb-4">
                    {activeBuckets.map((topic) => {
                      const picked = localTopics.includes(topic);
                      return (
                        <button
                          key={topic}
                          onClick={() => toggleTopic(topic)}
                          className="px-3 py-1.5 rounded-full text-xs font-semibold border transition-all duration-200"
                          style={{
                            background: picked ? 'var(--accent)' : 'var(--surface-2)',
                            borderColor: picked ? 'var(--accent)' : 'var(--border2)',
                            color: picked ? '#fff' : 'var(--text-2)',
                          }}
                        >
                          {picked ? '✓ ' : ''}{topic}
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex gap-2">
                    <button
                      className="text-xs font-medium underline"
                      style={{ color: 'var(--accent)' }}
                      onClick={() => setLocalTopics([...activeBuckets])}
                    >
                      Select all
                    </button>
                    <button
                      className="text-xs font-medium underline"
                      style={{ color: 'var(--text-3)' }}
                      onClick={() => setLocalTopics([])}
                    >
                      Clear
                    </button>
                  </div>
                </>
              ) : (
                <p className="text-sm" style={{ color: 'var(--text-3)' }}>
                  You entered a custom profession — Aria will cover all relevant topics automatically.
                </p>
              )}
            </Card>

            <div className="flex gap-3">
              <Button variant="ghost" onClick={() => goToStep(0)}>← Back</Button>
              <Button
                className="flex-1"
                onClick={() => {
                  store.setSelectedTopics(localTopics);
                  goToStep(2);
                }}
              >
                {localTopics.length > 0 ? `${localTopics.length} topic${localTopics.length > 1 ? 's' : ''} selected → Style` : 'Skip (all topics) → Style'}
              </Button>
            </div>
          </div>
        );
      })()}

      {/* Step 2: Style */}
      {step === 2 && (
        <div
          key={step}
          className="space-y-4"
          style={{
            animation: slideDir === 'forward'
              ? 'slideInRight 0.28s cubic-bezier(.22,.68,0,1.2) both'
              : 'slideInLeft 0.28s cubic-bezier(.22,.68,0,1.2) both',
          }}
        >
          <Card className="p-5">
            <SectionLabel>Difficulty</SectionLabel>
            <ChipGroup options={DIFFICULTIES} value={store.config.difficulty} onChange={(v) => store.setDifficulty(v as Difficulty)} />
          </Card>

          <Card className="p-5">
            <SectionLabel>Interview Type</SectionLabel>
            <ChipGroup options={INTERVIEW_TYPES} value={store.config.interviewType} onChange={(v) => store.setInterviewType(v as InterviewType)} />
          </Card>

          {store.config.mode === 'classic' && (
            <>
              <Card className="p-5">
                <SectionLabel>Number of Questions</SectionLabel>
                <ChipGroup options={QUESTION_COUNTS} value={String(store.config.totalQ)} onChange={(v) => store.setTotalQ(Number(v))} />
              </Card>
              <Card className="p-5">
                <SectionLabel>Time per Question</SectionLabel>
                <ChipGroup options={TIMERS} value={String(store.config.timerSecs)} onChange={(v) => store.setTimerSecs(Number(v))} />
              </Card>
            </>
          )}

          <Card className="p-5">
            <SectionLabel>
              Interview Language{' '}
              <span
                className="ml-2 text-[9px] rounded px-1.5 py-0.5 normal-case tracking-normal"
                style={{ background: 'var(--blue-dim)', color: 'var(--accent)', border: '1px solid var(--blue-border)' }}
              >
                UNIQUE IN INDIA
              </span>
            </SectionLabel>
            <p className="text-xs mb-3 font-medium" style={{ color: 'var(--text-3)' }}>AI + voice input adapts to your chosen language</p>
            <div className="grid grid-cols-3 gap-2">
              {[
                { lang: 'en',      flag: '🇬🇧', label: 'English' },
                { lang: 'hi',      flag: '🇮🇳', label: 'हिंदी' },
                { lang: 'hinglish',flag: '🇮🇳', label: 'Hinglish' },
              ].map((l) => {
                const isActive = store.config.lang === l.lang;
                return (
                  <button
                    key={l.lang}
                    onClick={() => { store.setLang(l.lang as 'en' | 'hi' | 'hinglish'); setPreviewMsg(null); }}
                    className="p-4 rounded-xl border text-left transition-all duration-200"
                    style={isActive
                      ? { borderColor: 'var(--accent-border)', background: 'var(--accent-dim)' }
                      : { borderColor: 'var(--border)', background: 'var(--surface-2)' }}
                  >
                    <div className="text-lg text-center">{l.flag}</div>
                    <div className="text-xs text-center mt-1" style={{ color: 'var(--text-1)' }}>{l.label}</div>
                  </button>
                );
              })}
            </div>
            <div className="mt-3 pt-3 border-t" style={{ borderColor: 'var(--border)' }}>
              <button
                type="button"
                onClick={playVoicePreview}
                disabled={previewLoading}
                className="text-xs font-semibold px-3 py-2 rounded-lg border transition-colors disabled:opacity-60 flex items-center gap-2"
                style={{ borderColor: 'var(--blue-border)', background: 'var(--blue-dim)', color: 'var(--accent)' }}
              >
                {previewLoading ? <>🔊 Loading preview…</> : !hasVoiceQuota && hasPreviewedToday ? <>🔊 Replay preview</> : <>🔊 Preview HD voice {!hasVoiceQuota ? '(free taste)' : ''}</>}
              </button>
              {previewMsg && (<p className="text-xs mt-2 font-medium" style={{ color: 'var(--text-3)' }}>{previewMsg}</p>)}
            </div>
          </Card>

          {/* JD paste */}
          <div>
            <button
              onClick={() => { setShowJd(!showJd); if (showJd) store.setJdText(''); }}
              className="text-sm flex items-center gap-2 transition-colors"
              style={{ color: 'var(--text-3)' }}
            >
              <span>📋</span>
              {showJd ? 'Remove job description' : 'Paste a job description (optional)'}
            </button>
            {showJd && (
              <div className="mt-3">
                <Card className="p-5">
                  <SectionLabel>Job Description</SectionLabel>
                  <p className="text-xs mb-3 font-medium" style={{ color: 'var(--text-3)' }}>
                    AI will generate questions tailored to this specific role instead of generic ones.
                  </p>
                  <textarea
                    value={store.config.jdText ?? ''}
                    onChange={(e) => store.setJdText(e.target.value.slice(0, 4_000))}
                    placeholder="Paste the job description here…"
                    rows={6}
                    maxLength={4_000}
                    className="w-full px-4 py-3 rounded-xl border text-sm resize-y focus:outline-none transition-colors"
                    style={{
                      background: 'var(--surface-2)',
                      borderColor: store.config.jdText ? 'var(--accent-border)' : 'var(--border)',
                      color: 'var(--text-1)',
                    }}
                    onFocus={e  => (e.currentTarget.style.borderColor = 'var(--accent-border)')}
                    onBlur={e   => (e.currentTarget.style.borderColor = store.config.jdText ? 'var(--accent-border)' : 'var(--border)')}
                  />
                  <p className="text-xs mt-2 font-medium" style={{ color: 'var(--text-3)' }}>
                    {store.config.jdText
                      ? `✓ ${store.config.jdText.length.toLocaleString()} / 4,000 chars — questions will be tailored to this JD`
                      : 'Supports English, Hindi, or mixed — paste any JD'}
                  </p>
                </Card>
              </div>
            )}
          </div>

          {/* Voice-only toggle */}
          <div
            className="flex items-center justify-between rounded-xl px-4 py-3 border"
            style={{ background: 'var(--surface-2)', borderColor: 'var(--border)' }}
          >
            <div>
              <p className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>📵 Voice only (saves data)</p>
              <p className="text-xs mt-0.5 font-medium" style={{ color: 'var(--text-3)' }}>Disables the AI avatar — audio only. Best for 2G / low-memory devices.</p>
            </div>
            <button
              role="switch"
              aria-checked={store.config.avatarMode === 'voice-only'}
              onClick={() => store.setAvatarMode(store.config.avatarMode === 'voice-only' ? 'full' : 'voice-only')}
              className="relative flex-shrink-0 w-11 h-6 rounded-full border-2 transition-colors duration-200 focus:outline-none"
              style={{
                background: store.config.avatarMode === 'voice-only' ? 'var(--accent)' : 'var(--surface-3, #d1d5db)',
                borderColor: store.config.avatarMode === 'voice-only' ? 'var(--accent)' : 'var(--border)',
              }}
            >
              <span
                className="block w-4 h-4 rounded-full bg-white shadow transition-transform duration-200"
                style={{
                  transform: store.config.avatarMode === 'voice-only' ? 'translateX(20px)' : 'translateX(2px)',
                  marginTop: '1px',
                }}
              />
            </button>
          </div>

          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => goToStep(1)}>← Back</Button>
            <Button className="flex-1" disabled={!step2Complete} onClick={() => goToStep(3)}>Review →</Button>
          </div>
        </div>
      )}

      {/* Step 3: Review + Start */}
      {step === 3 && (
        <div
          key={step}
          className="space-y-4"
          style={{
            animation: slideDir === 'forward'
              ? 'slideInRight 0.28s cubic-bezier(.22,.68,0,1.2) both'
              : 'slideInLeft 0.28s cubic-bezier(.22,.68,0,1.2) both',
          }}
        >
          {/* Live preview card */}
          {livePreview && (
            <Card
              className="p-5 transition-all duration-300"
              style={{
                background: 'var(--blue-dim)',
                borderColor: 'var(--blue-border)',
              }}
            >
              <div className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--accent)' }}>
                Session Preview
              </div>
              <p className="text-sm font-medium leading-relaxed mb-1" style={{ color: 'var(--text-1)' }}>
                {livePreview.line1.split(' ').map((word, i) => {
                  // Highlight profession, difficulty, type tokens
                  const profLabel = selectedTrackName || customProfession.trim() || selectedProfession;
                  const isProfession = profLabel ? livePreview.line1.indexOf(profLabel) !== -1 && word !== '' && profLabel.includes(word) && word.length > 2 : false;
                  const isDiff = store.config.difficulty && word.includes(store.config.difficulty);
                  const isType = store.config.interviewType && word.includes(store.config.interviewType);
                  if (isProfession || isDiff || isType) {
                    return (
                      <span key={i} className="inline-block px-1.5 py-0.5 rounded mx-0.5 text-xs font-bold"
                        style={{ background: 'var(--accent)', color: '#fff' }}>
                        {word}
                      </span>
                    );
                  }
                  return <span key={i}>{word} </span>;
                })}
              </p>
              {livePreview.line2 && (
                <p className="text-xs font-medium" style={{ color: 'var(--text-3)' }}>{livePreview.line2}</p>
              )}
            </Card>
          )}

          {/* Review summary */}
          <Card className="p-5 space-y-3">
            <SectionLabel>Your Setup</SectionLabel>
            {[
              { label: 'Track',      value: selectedTrackName || customProfession.trim() || '—' },
              { label: 'Topics',     value: localTopics.length > 0 ? localTopics.join(', ') : 'All topics' },
              { label: 'Mode',       value: store.config.mode === 'chat' ? 'AI Chat Mode' : 'Classic Mode' },
              { label: 'Difficulty', value: store.config.difficulty || '—' },
              { label: 'Type',       value: store.config.interviewType || '—' },
              ...(selectedTrackName && COMPANY_MODE_TRACKS.has(selectedTrackName) ? [
                { label: 'Company Mode', value: store.config.companyMode ? store.config.companyMode.charAt(0).toUpperCase() + store.config.companyMode.slice(1) : 'Generic prep' },
              ] : []),
              ...(store.config.mode === 'classic' ? [
                { label: 'Questions', value: `${store.config.totalQ}` },
                { label: 'Timer', value: store.config.timerSecs ? `${store.config.timerSecs / 60} min` : 'No Timer' },
              ] : []),
              { label: 'Language', value: store.config.lang === 'hi' ? 'हिंदी' : store.config.lang === 'hinglish' ? 'Hinglish' : 'English' },
            ].map(({ label, value }) => (
              <div key={label} className="flex items-center justify-between">
                <span className="text-xs font-medium" style={{ color: 'var(--text-3)' }}>{label}</span>
                <span className="text-xs font-semibold" style={{ color: 'var(--text-1)' }}>{value}</span>
              </div>
            ))}
            <button
              onClick={() => goToStep(0)}
              className="text-xs mt-2 transition-colors"
              style={{ color: 'var(--accent)' }}
            >
              ✏ Edit track / mode
            </button>
            {' · '}
            <button
              onClick={() => goToStep(2)}
              className="text-xs transition-colors"
              style={{ color: 'var(--accent)' }}
            >
              ✏ Edit style
            </button>
          </Card>

          {FLAG.HUMANIZED_COACH_PROMPT && (
            <div
              className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium"
              style={{ background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid var(--accent-border)' }}
            >
              <span aria-hidden>✨</span>
              Smart coaching active — Aria adapts her feedback style to your confidence
            </div>
          )}

          {error && (
            <p className="text-sm rounded-xl px-4 py-3" style={{ color: 'var(--error)', background: 'var(--error-dim)', border: '1px solid var(--error-border)' }}>
              {error}
            </p>
          )}

          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => goToStep(2)}>← Back</Button>
            <Button
              size="lg"
              className="flex-1"
              loading={starting}
              disabled={isLocked || !step0Complete}
              onClick={handleStart}
              style={allStepsComplete ? {
                boxShadow: '0 0 0 3px var(--accent-dim), 0 4px 20px rgba(99,102,241,.3)',
              } : undefined}
            >
              🎙 Start Interview
            </Button>
          </div>
        </div>
      )}

      {/* Slide animation keyframes */}
      <style>{`
        @keyframes slideInRight {
          from { opacity: 0; transform: translateX(32px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        @keyframes slideInLeft {
          from { opacity: 0; transform: translateX(-32px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        @media (max-width: 480px) {
          .pp27-grid { grid-template-columns: repeat(2, 1fr) !important; }
        }
      `}</style>
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
