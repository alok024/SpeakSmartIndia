'use client';

/**
 * app/(app)/english/page.tsx — Elara English Coach
 *
 * Tier behaviour:
 *
 *   Free     — text chat only. No mic, no TTS. All four modes.
 *              Corrections shown as inline diff cards (no persistence).
 *
 *   Pro+     — voice-enabled. Mic + TTS. Scores persisted to elara_sessions
 *              after conversation ends. Vocab tracker active: errors tracked
 *              automatically, user can tap any error to manually save it.
 *              Vocab sidebar shows saved words. System prompt injected with
 *              top-10 weak words at conversation start.
 *
 *   Elite    — everything Pro has + Hinglish toggle.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { Button, Card, CardHeader, CardBody, Badge, ChipGroup, Spinner } from '@/components/ui';
import { useAuthStore } from '@/store/auth';
import { aiApi } from '@/features/ai/api';
import { elaraApi, type VocabWord, type VocabError } from '@/features/elara/api';
import { useElaraVoice } from '@/features/elara/useElaraVoice';
import { getElaraSystemPrompt, parseElaraResponse, getLiveFeedback, type ElaraMode } from '@/lib/interview-prompts';
import { Send, RotateCcw, Mic, MicOff, BookMarked, Plus, X } from 'lucide-react';

const MODE_OPTIONS: { label: string; value: ElaraMode }[] = [
  { label: '💬 Conversation', value: 'conversation' },
  { label: '📚 Topics',       value: 'topics' },
  { label: '📝 Correction',   value: 'correction' },
  { label: '🔤 Vocabulary',   value: 'vocabulary' },
];

const TOPICS = ['Daily life', 'Work & career', 'Technology', 'Current affairs', 'Travel', 'Health & fitness', 'Family', 'Education'];

const MAX_ANSWER_LENGTH = 2_000;

interface ChatMsg {
  role: 'user' | 'assistant';
  content: string;
  analysis?: ReturnType<typeof parseElaraResponse>['analysis'];
}

function ElaraAvatar({ size = 28 }: { size?: number }) {
  return (
    <div
      className="flex-shrink-0 rounded-full flex items-center justify-center font-bold text-white"
      style={{ width: size, height: size, fontSize: size * 0.4, background: 'var(--blue)' }}
    >
      E
    </div>
  );
}

function buildCorrectionScript(errors: Array<{ wrong: string; correct: string; rule?: string }>): string {
  if (!errors.length) return '';
  return errors.slice(0, 3)
    .map(e => `Instead of "${e.wrong}", say "${e.correct}".${e.rule ? ` ${e.rule}` : ''}`)
    .join(' ');
}

// ── Vocab sidebar ─────────────────────────────────────────────────────────

function VocabSidebar({
  words,
  onClose,
}: {
  words: VocabWord[];
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-y-0 right-0 w-72 z-30 flex flex-col border-l shadow-xl"
      style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
        <span className="text-sm font-bold flex items-center gap-2" style={{ color: 'var(--text-1)' }}>
          <BookMarked className="w-4 h-4" style={{ color: 'var(--accent)' }} />
          My Vocab List
        </span>
        <button onClick={onClose} style={{ color: 'var(--text-3)' }}><X className="w-4 h-4" /></button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
        {words.length === 0 && (
          <p className="text-xs text-center py-8" style={{ color: 'var(--text-3)' }}>
            Tap any correction card to save a word. Words you repeat 3+ times are auto-saved.
          </p>
        )}
        {words.map((w, i) => (
          <div
            key={w.id ?? i}
            className="rounded-xl px-3 py-2 border"
            style={{ background: 'var(--surface-2)', borderColor: 'var(--border)' }}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium" style={{ color: 'var(--error)', textDecoration: 'line-through' }}>
                {w.wrong_form}
              </span>
              <span
                className="text-[9px] font-bold px-1.5 py-0.5 rounded"
                style={w.auto_saved
                  ? { background: 'var(--accent-dim)', color: 'var(--accent)' }
                  : { background: 'var(--surface-3)', color: 'var(--text-3)' }
                }
              >
                {w.auto_saved ? `×${w.occurrences}` : '✓'}
              </span>
            </div>
            <div className="text-xs mt-0.5 font-semibold" style={{ color: 'var(--success)' }}>
              → {w.correct_form}
            </div>
            {w.rule && (
              <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-3)' }}>{w.rule}</div>
            )}
          </div>
        ))}
      </div>

      <div className="px-4 py-3 border-t text-[10px]" style={{ borderColor: 'var(--border)', color: 'var(--text-3)' }}>
        Words flagged 3+ times are auto-saved. Elara will reinforce them in future sessions.
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────

export default function EnglishPage() {
  const { user } = useAuthStore();

  const [mode,        setMode]        = useState<ElaraMode>('conversation');
  const [topic,       setTopic]       = useState('Daily life');
  const [messages,    setMessages]    = useState<ChatMsg[]>([]);
  const [input,       setInput]       = useState('');
  const [loading,     setLoading]     = useState(false);
  const [avgGrammar,  setAvgGrammar]  = useState<number | null>(null);
  const [avgFluency,  setAvgFluency]  = useState<number | null>(null);
  const [avgVocab,    setAvgVocab]    = useState<number | null>(null);
  const [sessionId,   setSessionId]   = useState<string>(() => crypto.randomUUID());
  const [msgCount,    setMsgCount]    = useState(0);

  // Voice / Hindi
  const [isListening,  setIsListening]  = useState(false);
  const [hindiPref,    setHindiPref]    = useState(false);
  const [hindiLoading, setHindiLoading] = useState(false);

  // Vocab
  const [vocabWords,      setVocabWords]      = useState<VocabWord[]>([]);
  const [showVocabPanel,  setShowVocabPanel]  = useState(false);
  const [savingWord,      setSavingWord]      = useState<string | null>(null);

  // Vocab prompt block fetched at conversation start (Pro+)
  const vocabPromptRef = useRef<string>('');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  const bottomRef      = useRef<HTMLDivElement>(null);

  const isElite = user?.plan === 'elite';
  const isPro   = user?.plan === 'pro' || isElite;
  const { speak: elaraSpeak, canSpeak } = useElaraVoice({ user: user ?? null });

  // Load Hindi pref (Elite)
  useEffect(() => {
    if (!isElite) return;
    elaraApi.getPrefs().then(r => { if (r.ok) setHindiPref(r.data.elara_hindi_pref); });
  }, [isElite]);

  // Load vocab list + vocab prompt (Pro+) on mount
  useEffect(() => {
    if (!isPro) return;
    elaraApi.getVocab().then(r => { if (r.ok) setVocabWords(r.data.words); });
    elaraApi.getVocabPrompt().then(r => {
      if (r.ok) vocabPromptRef.current = r.data.prompt_block;
    });
  }, [isPro]);

  // Scroll to bottom
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  // Rolling score averages
  useEffect(() => {
    const analyzed = messages.filter(m => m.role === 'assistant' && m.analysis);
    if (!analyzed.length) return;
    const avg = (key: 'grammar_score' | 'fluency_score' | 'vocab_score') =>
      Math.round(analyzed.reduce((a, m) => a + (m.analysis?.[key] ?? 0), 0) / analyzed.length * 10) / 10;
    setAvgGrammar(avg('grammar_score'));
    setAvgFluency(avg('fluency_score'));
    setAvgVocab(avg('vocab_score'));
  }, [messages]);

  // Save conversation scores when the user resets or leaves (Pro+)
  const flushSession = useCallback(async (
    curSessionId: string,
    grammar: number | null,
    fluency: number | null,
    vocab: number | null,
    count: number,
    curMode: string,
  ) => {
    if (!isPro || count === 0) return;
    // Fire-and-forget — never block UI
    elaraApi.saveSession({
      client_session_id: curSessionId,
      grammar_score:     grammar,
      fluency_score:     fluency,
      vocab_score:       vocab,
      message_count:     count,
      mode:              curMode,
    }).catch(() => {/* non-fatal */});
  }, [isPro]);

  // ── Toggle Hindi pref (Elite) ──────────────────────────────────────────

  const toggleHindi = async () => {
    if (hindiLoading) return;
    setHindiLoading(true);
    const next = !hindiPref;
    setHindiPref(next);
    const result = await elaraApi.setHindiPref(next);
    if (!result.ok) setHindiPref(!next);
    setHindiLoading(false);
  };

  // ── STT (Pro+) ─────────────────────────────────────────────────────────

  const startListening = useCallback(() => {
    if (typeof window === 'undefined') return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!SR) return;
    const rec = new SR();
    rec.lang = 'en-IN';
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (e: { results: { [x: number]: { [x: number]: { transcript: string; }; }; }; }) => {
      const t = e.results[0][0].transcript;
      setInput(prev => (prev ? `${prev} ${t}` : t).slice(0, MAX_ANSWER_LENGTH));
    };
    rec.onend = () => setIsListening(false);
    rec.onerror = () => setIsListening(false);
    recognitionRef.current = rec;
    rec.start();
    setIsListening(true);
  }, []);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    setIsListening(false);
  }, []);

  // ── Manual vocab save (tap on an error card) ───────────────────────────

  const handleManualSave = async (wrong: string, correct: string, rule?: string) => {
    if (!isPro || savingWord) return;
    setSavingWord(wrong);
    await elaraApi.saveWord(wrong, correct, rule);
    // Refresh list
    const r = await elaraApi.getVocab();
    if (r.ok) setVocabWords(r.data.words);
    setSavingWord(null);
  };

  // ── Send message ────────────────────────────────────────────────────────

  async function handleSend() {
    if (!input.trim() || loading) return;

    const userMsg: ChatMsg = { role: 'user', content: input.trim() };
    const newHistory = [...messages, userMsg];
    setMessages(newHistory);
    setInput('');
    setLoading(true);

    const hindiInstruction = isElite && hindiPref
      ? '\n\nIMPORTANT: After every correction card, add one sentence explaining the rule in natural Hinglish (mix Hindi + English). Label it "🇮🇳 Hindi note:".'
      : '';

    // Inject vocab reinforcement block (Pro+ only, fetched once at session start)
    const vocabInjection = isPro ? vocabPromptRef.current : '';

    const systemPrompt = getElaraSystemPrompt(mode, topic) + hindiInstruction + vocabInjection;
    const priorTurns   = messages.slice(-8).map(m => ({ role: m.role, content: m.content }));
    const conversationMessages = [
      { role: 'user' as const, content: `[SYSTEM]: ${systemPrompt}` },
      ...priorTurns,
      { role: 'user' as const, content: input.trim() },
    ];

    try {
      const res = await aiApi.call({
        messages:   conversationMessages,
        topic:      'English coaching',
        session_id: sessionId,
      });

      if (res.ok) {
        const { reply, analysis } = parseElaraResponse(res.data.text);
        const newMsg: ChatMsg = { role: 'assistant', content: reply, analysis };
        setMessages(prev => [...prev, newMsg]);
        setMsgCount(c => c + 1);

        // Pro+: speak corrections
        if (canSpeak && analysis?.errors?.length) {
          const script = buildCorrectionScript(analysis.errors);
          if (script) elaraSpeak(script);
        }

        // Pro+: fire-and-forget vocab error tracking
        if (isPro && analysis?.errors?.length) {
          const vocabErrors: VocabError[] = analysis.errors.map(e => ({
            wrong:   e.wrong,
            correct: e.correct,
            rule:    e.rule,
          }));
          elaraApi.trackErrors(vocabErrors, sessionId)
            .then(r => {
              // Refresh vocab list silently if any new word crossed threshold
              if (r.ok) {
                elaraApi.getVocab().then(vr => { if (vr.ok) setVocabWords(vr.data.words); });
              }
            })
            .catch(() => {/* non-fatal */});
        }
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content: '⚠ Could not get response. Try again.' }]);
      }
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: '⚠ Network error. Check your connection and try again.' }]);
    } finally {
      setLoading(false);
    }
  }

  function resetChat() {
    // Flush current session before resetting
    flushSession(sessionId, avgGrammar, avgFluency, avgVocab, msgCount, mode);

    setMessages([]);
    setAvgGrammar(null);
    setAvgFluency(null);
    setAvgVocab(null);
    setMsgCount(0);
    const newId = crypto.randomUUID();
    setSessionId(newId);

    // Re-fetch vocab prompt for the new session
    if (isPro) {
      elaraApi.getVocabPrompt().then(r => {
        if (r.ok) vocabPromptRef.current = r.data.prompt_block;
      });
    }
  }

  const liveChips = getLiveFeedback(input);

  return (
    <>
      {/* Vocab sidebar */}
      {showVocabPanel && (
        <VocabSidebar words={vocabWords} onClose={() => setShowVocabPanel(false)} />
      )}

      <div className="p-4 sm:p-6 max-w-2xl mx-auto space-y-4">

        {/* Header */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <ElaraAvatar size={40} />
            <div>
              <h1 className="text-lg font-bold" style={{ color: 'var(--text-1)' }}>Elara — English Coach</h1>
              <p className="text-xs font-medium" style={{ color: 'var(--text-3)' }}>Grammar corrections, vocabulary & fluency coaching</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Pro+: Vocab panel toggle */}
            {isPro && (
              <button
                onClick={() => setShowVocabPanel(v => !v)}
                className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors relative"
                style={showVocabPanel
                  ? { background: 'rgba(var(--accent-rgb,124,95,255),.15)', borderColor: 'var(--accent-border)', color: 'var(--accent)' }
                  : { background: 'var(--surface-2)', borderColor: 'var(--border)', color: 'var(--text-3)' }
                }
                title="My vocabulary list"
              >
                <BookMarked className="w-3.5 h-3.5" />
                Vocab
                {vocabWords.length > 0 && (
                  <span
                    className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full text-[9px] font-bold flex items-center justify-center text-white"
                    style={{ background: 'var(--accent)' }}
                  >
                    {vocabWords.length > 9 ? '9+' : vocabWords.length}
                  </span>
                )}
              </button>
            )}

            {/* Elite: Hindi toggle */}
            {isElite && (
              <button
                onClick={toggleHindi}
                disabled={hindiLoading}
                className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors"
                style={hindiPref
                  ? { background: 'rgba(var(--accent-rgb,124,95,255),.15)', borderColor: 'var(--accent-border)', color: 'var(--accent)' }
                  : { background: 'var(--surface-2)', borderColor: 'var(--border)', color: 'var(--text-3)' }
                }
                title={hindiPref ? 'Hinglish explanations on' : 'Enable Hinglish explanations'}
              >
                🇮🇳 {hindiPref ? 'Hinglish on' : 'Hinglish'}
              </button>
            )}
          </div>
        </div>

        {/* Rolling scores */}
        {avgGrammar != null && (
          <div
            className="flex gap-6 rounded-2xl px-5 py-3 overflow-x-auto border"
            style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
          >
            {[
              { label: 'Grammar',    val: avgGrammar, color: 'var(--success)' },
              { label: 'Fluency',    val: avgFluency, color: 'var(--accent)' },
              { label: 'Vocabulary', val: avgVocab,   color: 'var(--warn)' },
            ].map(s => (
              <div key={s.label} className="text-center min-w-[56px]">
                <div className="text-xl font-bold tabular-nums" style={{ color: s.color }}>{s.val ?? '—'}</div>
                <div className="text-[11px] font-medium" style={{ color: 'var(--text-3)' }}>{s.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Mode selector */}
        <Card className="p-4">
          <div className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--text-3)' }}>Mode</div>
          <ChipGroup options={MODE_OPTIONS} value={mode} onChange={v => { setMode(v as ElaraMode); resetChat(); }} />

          {mode === 'topics' && (
            <div className="mt-3">
              <div className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--text-3)' }}>Topic</div>
              <div className="flex flex-wrap gap-2">
                {TOPICS.map(t => (
                  <button
                    key={t}
                    onClick={() => setTopic(t)}
                    className="px-3 py-1 rounded-full text-xs border transition-all"
                    style={topic === t
                      ? { background: 'var(--accent-dim)', borderColor: 'var(--accent-border)', color: 'var(--accent)' }
                      : { background: 'var(--surface-2)', borderColor: 'var(--border)', color: 'var(--text-2)' }}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          )}
        </Card>

        {/* Chat */}
        <Card>
          <CardHeader className="flex items-center justify-between">
            <span className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>Practice</span>
            <button
              onClick={resetChat}
              className="text-xs flex items-center gap-1 transition-colors font-medium"
              style={{ color: 'var(--text-3)' }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-2)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-3)')}
            >
              <RotateCcw className="w-3 h-3" /> Reset
            </button>
          </CardHeader>
          <CardBody>
            <div className="space-y-4 min-h-[240px] sm:min-h-[320px] mb-4">
              {messages.length === 0 && (
                <p className="text-sm text-center py-8" style={{ color: 'var(--text-3)' }}>
                  {mode === 'conversation' && 'Start talking — Elara will correct your English naturally.'}
                  {mode === 'topics' && `Let's talk about: ${topic}. Start whenever you're ready!`}
                  {mode === 'vocabulary' && 'Type a word or phrase to explore its meaning and usage.'}
                  {mode === 'correction' && 'Type a sentence and Elara will correct it.'}
                  {isPro && vocabPromptRef.current && (
                    <span className="block mt-2 text-xs" style={{ color: 'var(--accent)' }}>
                      ✦ Elara will reinforce your saved vocab words in this session.
                    </span>
                  )}
                </p>
              )}

              {messages.map((msg, i) => (
                <div key={i}>
                  <div className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    {msg.role === 'assistant' && <ElaraAvatar size={28} />}
                    <div
                      className={`max-w-[80%] px-4 py-3 rounded-2xl text-sm leading-relaxed ${msg.role === 'assistant' ? 'ml-2' : ''}`}
                      style={msg.role === 'user'
                        ? { background: 'var(--accent-dim)', border: '1px solid var(--accent-border)', color: 'var(--text-1)' }
                        : { background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
                    >
                      {msg.content}
                    </div>
                  </div>

                  {msg.analysis && (
                    <div className="ml-9 mt-2 space-y-2">
                      <div className="flex flex-wrap gap-2">
                        {msg.analysis.grammar_score != null && <Badge variant="success">Grammar {msg.analysis.grammar_score}/10</Badge>}
                        {msg.analysis.fluency_score != null && <Badge variant="accent">Fluency {msg.analysis.fluency_score}/10</Badge>}
                        {msg.analysis.vocab_score   != null && <Badge variant="warn">Vocab {msg.analysis.vocab_score}/10</Badge>}
                      </div>

                      {msg.analysis.errors && msg.analysis.errors.length > 0 && (
                        <div className="space-y-1">
                          {msg.analysis.errors.map((e, j) => {
                            const isAlreadySaved = vocabWords.some(w => w.wrong_form === e.wrong.toLowerCase().trim());
                            return (
                              <div
                                key={j}
                                className="text-xs rounded-xl px-3 py-2"
                                style={{ background: 'var(--error-dim)', border: '1px solid var(--error-border)' }}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <div>
                                    <span style={{ color: 'var(--error)', textDecoration: 'line-through' }}>{e.wrong}</span>
                                    <span className="mx-2" style={{ color: 'var(--text-3)' }}>→</span>
                                    <span style={{ color: 'var(--success)' }}>{e.correct}</span>
                                    {e.rule && <div className="mt-0.5" style={{ color: 'var(--text-3)' }}>{e.rule}</div>}
                                    {isElite && hindiPref && e.rule && (
                                      <div className="mt-1 text-xs italic" style={{ color: 'var(--warn)' }}>🇮🇳 {e.rule}</div>
                                    )}
                                  </div>

                                  {/* Pro+: manual save button */}
                                  {isPro && (
                                    <button
                                      onClick={() => handleManualSave(e.wrong, e.correct, e.rule)}
                                      disabled={isAlreadySaved || savingWord === e.wrong}
                                      title={isAlreadySaved ? 'Already saved' : 'Save to vocab list'}
                                      className="flex-shrink-0 w-6 h-6 rounded-lg flex items-center justify-center border transition-colors"
                                      style={isAlreadySaved
                                        ? { background: 'var(--success-dim)', borderColor: 'var(--success)', color: 'var(--success)' }
                                        : { background: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--text-3)' }
                                      }
                                    >
                                      {isAlreadySaved ? '✓' : <Plus className="w-3 h-3" />}
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {msg.analysis.vocab_upgrade && (
                        <div
                          className="text-xs rounded-xl px-3 py-2"
                          style={{ background: 'var(--warn-dim)', border: '1px solid var(--warn-border)' }}
                        >
                          <span style={{ color: 'var(--text-3)' }}>Basic:</span>{' '}
                          <span style={{ color: 'var(--warn)' }}>{msg.analysis.vocab_upgrade.basic}</span>
                          <span className="mx-2" style={{ color: 'var(--text-3)' }}>→</span>
                          <span style={{ color: 'var(--success)' }}>{msg.analysis.vocab_upgrade.better}</span>
                        </div>
                      )}

                      {msg.analysis.tip && (
                        <p className="text-xs italic font-medium" style={{ color: 'var(--text-3)' }}>{msg.analysis.tip}</p>
                      )}
                    </div>
                  )}
                </div>
              ))}

              {loading && (
                <div className="flex justify-start items-center gap-2">
                  <ElaraAvatar size={28} />
                  <div className="px-4 py-3 rounded-2xl border" style={{ background: 'var(--surface-2)', borderColor: 'var(--border)' }}>
                    <Spinner size={14} style={{ color: 'var(--accent)' }} />
                  </div>
                </div>
              )}

              <div ref={bottomRef} />
            </div>

            {/* Live feedback chips */}
            {liveChips.length > 0 && input.length > 5 && (
              <div className="flex flex-wrap gap-2 mb-3">
                {liveChips.map((chip, i) => (
                  <span
                    key={i}
                    className="text-xs px-2.5 py-1 rounded-full border"
                    style={
                      chip.type === 'ok'     ? { background: 'var(--success-dim)', color: 'var(--success)', borderColor: 'var(--success-border)' } :
                      chip.type === 'filler' ? { background: 'var(--warn-dim)',    color: 'var(--warn)',    borderColor: 'var(--warn-border)' } :
                                               { background: 'var(--error-dim)',   color: 'var(--error)',   borderColor: 'var(--error-border)' }
                    }
                  >
                    {chip.msg}
                  </span>
                ))}
              </div>
            )}

            {/* Input row */}
            <div className="flex gap-2" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
              {isPro && (
                <button
                  onClick={isListening ? stopListening : startListening}
                  className="flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center border transition-colors"
                  style={isListening
                    ? { background: 'rgba(239,68,68,.15)', borderColor: '#ef4444', color: '#ef4444' }
                    : { background: 'var(--surface-2)', borderColor: 'var(--border)', color: 'var(--text-3)' }
                  }
                  title={isListening ? 'Stop recording' : 'Speak your message'}
                >
                  {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                </button>
              )}

              <input
                className="flex-1 px-4 py-3 rounded-xl text-sm focus:outline-none"
                style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
                placeholder={isPro ? 'Type or speak in English…' : 'Type in English…'}
                value={input}
                onChange={e => setInput(e.target.value.slice(0, MAX_ANSWER_LENGTH))}
                maxLength={MAX_ANSWER_LENGTH}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                onFocus={e  => (e.currentTarget.style.borderColor = 'var(--accent-border)')}
                onBlur={e   => (e.currentTarget.style.borderColor = 'var(--border)')}
              />
              <Button disabled={!input.trim() || loading} onClick={handleSend}>
                <Send className="w-4 h-4" />
              </Button>
            </div>

            {!isPro && (
              <p className="text-xs mt-2 text-center" style={{ color: 'var(--text-3)' }}>
                <a href="/pricing" style={{ color: 'var(--accent)' }}>Upgrade to Pro</a> to speak with Elara using voice and track your progress
              </p>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
