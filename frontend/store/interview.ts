import { create } from 'zustand';
import {
  LiveSessionConfig,
  LiveSessionState,
  SessionMode,
  Difficulty,
  InterviewType,
  Persona,
  Feedback,
  ErrorCorrection,
} from '@/types';

// Default config — matches v4 defaults exactly
const DEFAULT_CONFIG: LiveSessionConfig = {
  profession: '',
  mode: 'classic',
  interviewType: 'Technical',
  difficulty: 'beginner',
  totalQ: 5,
  timerSecs: 120,
  persona: 'friendly',
  maxExchanges: 6,
  lang: 'en',
};

const DEFAULT_SESSION: LiveSessionState = {
  questions: [],
  currentQ: 0,
  allFeedbacks: [],
  allErrors: [],
  chatHistory: [],
  chatExchanges: 0,
  chatErrors: [],
  sessionStartTime: null,
  timerRemaining: 0,
  clientSessionId: null,
  lastSessionId: null,
  voiceReplies: false,
};

interface InterviewStore {
  config: LiveSessionConfig;
  session: LiveSessionState;

  // Config actions
  setProfession: (p: string) => void;
  setMode: (m: SessionMode) => void;
  setDifficulty: (d: Difficulty) => void;
  setInterviewType: (t: InterviewType) => void;
  setTotalQ: (n: number) => void;
  setTimerSecs: (s: number) => void;
  setPersona: (p: Persona) => void;
  setMaxExchanges: (n: number) => void;
  setLang: (l: 'en' | 'hi' | 'hinglish') => void;

  // Session lifecycle — clear entry points, no leaked state
  startSession:  (config?: Partial<LiveSessionConfig>) => void;
  expireSession: () => void;   // called by timer reaching zero; marks session as timed-out
  resetSession:  () => void;   // navigate-away / explicit reset

  // Timer lifecycle — owned entirely by the store, never by a component
  startTimer: () => void;
  stopTimer:  () => void;

  // Session mutations
  setQuestions:           (qs: string[]) => void;
  nextQuestion:           () => void;
  addFeedback:            (fb: Feedback) => void;
  addErrors:              (errs: ErrorCorrection[]) => void;
  addChatMessage:         (role: 'user' | 'assistant', content: string) => void;
  incrementChatExchanges: () => void;
  addChatError:           (err: ErrorCorrection) => void;
  setTimerRemaining:      (t: number) => void;
  setLastSessionId:       (id: string) => void;
  setClientSessionId:     (id: string) => void;
  setVoiceReplies:        (v: boolean) => void;
}

// Timer handle — kept outside Zustand state intentionally
// setInterval handles are not serialisable and must never live inside
// a state snapshot: Zustand would try to diff/spread them on every set()
// call, causing unnecessary re-renders and making it impossible to call
// clearInterval reliably (the handle in state may be stale by the time a
// selector reads it). We keep one module-level reference instead.
let _timerHandle: ReturnType<typeof setInterval> | null = null;

function _clearTimer() {
  if (_timerHandle !== null) {
    clearInterval(_timerHandle);
    _timerHandle = null;
  }
}

export const useInterviewStore = create<InterviewStore>((set, get) => ({
  config:  { ...DEFAULT_CONFIG },
  session: { ...DEFAULT_SESSION },

  // Config
  setProfession:    (p) => set((s) => ({ config: { ...s.config, profession: p } })),
  setMode:          (m) => set((s) => ({ config: { ...s.config, mode: m } })),
  setDifficulty:    (d) => set((s) => ({ config: { ...s.config, difficulty: d } })),
  setInterviewType: (t) => set((s) => ({ config: { ...s.config, interviewType: t } })),
  setTotalQ:        (n) => set((s) => ({ config: { ...s.config, totalQ: n } })),
  setTimerSecs:     (secs) => set((s) => ({ config: { ...s.config, timerSecs: secs } })),
  setPersona:       (p) => set((s) => ({ config: { ...s.config, persona: p } })),
  setMaxExchanges:  (n) => set((s) => ({ config: { ...s.config, maxExchanges: n } })),
  setLang:          (l) => set((s) => ({ config: { ...s.config, lang: l } })),

  // Session lifecycle

  startSession: (overrides) => {
    _clearTimer(); // always evict any previous timer before starting fresh
    const clientSessionId = crypto.randomUUID();
    set((s) => ({
      config: { ...s.config, ...overrides },
      session: {
        ...DEFAULT_SESSION,
        clientSessionId,
        sessionStartTime: Date.now(),
        timerRemaining: s.config.timerSecs,
        voiceReplies: s.session.voiceReplies, // preserve voice pref across sessions
      },
    }));
  },

  expireSession: () => {
    // Timer hit zero: stop ticking and let the calling component decide
    // what to do (usually call finishSession() immediately).
    _clearTimer();
    set((s) => ({ session: { ...s.session, timerRemaining: 0 } }));
  },

  resetSession: () => {
    _clearTimer();
    set((s) => ({
      session: {
        ...DEFAULT_SESSION,
        voiceReplies: s.session.voiceReplies,
      },
    }));
  },

  // Timer lifecycle
  // Components call startTimer() on mount and stopTimer() on unmount (or
  // when finishSession is called). The store ticks timerRemaining down
  // and fires expireSession() when it hits zero — no component needs to
  // check the countdown value in a useEffect.

  startTimer: () => {
    _clearTimer(); // guard against double-start

    // Wall-clock deadline (see former TIMER_FIX.patch): counter-based
    // setInterval drifts when the tab is throttled/backgrounded, since
    // browsers slow or pause timers in inactive tabs but `Date.now()`
    // keeps moving in real time. Compute the deadline once from the
    // current timerRemaining, then derive the remaining seconds from the
    // deadline on every tick — immune to missed/delayed ticks.
    const deadline = Date.now() + get().session.timerRemaining * 1000;

    _timerHandle = setInterval(() => {
      const remaining = Math.max(0, Math.round((deadline - Date.now()) / 1000));
      if (remaining <= 0) {
        get().expireSession();
      } else {
        set((s) => ({ session: { ...s.session, timerRemaining: remaining } }));
      }
    }, 250); // poll faster than 1s for a smooth display + prompt expiry once the tab regains focus
  },

  stopTimer: () => {
    _clearTimer();
  },

  // Session mutations

  setQuestions: (qs) =>
    set((s) => ({ session: { ...s.session, questions: qs } })),

  nextQuestion: () =>
    set((s) => ({ session: { ...s.session, currentQ: s.session.currentQ + 1 } })),

  addFeedback: (fb) =>
    set((s) => ({ session: { ...s.session, allFeedbacks: [...s.session.allFeedbacks, fb] } })),

  addErrors: (errs) =>
    set((s) => ({ session: { ...s.session, allErrors: [...s.session.allErrors, ...errs] } })),

  addChatMessage: (role, content) =>
    set((s) => ({
      session: {
        ...s.session,
        chatHistory: [...s.session.chatHistory, { role, content }],
      },
    })),

  incrementChatExchanges: () =>
    set((s) => ({ session: { ...s.session, chatExchanges: s.session.chatExchanges + 1 } })),

  addChatError: (err) =>
    set((s) => ({ session: { ...s.session, chatErrors: [...s.session.chatErrors, err] } })),

  setTimerRemaining: (t) =>
    set((s) => ({ session: { ...s.session, timerRemaining: t } })),

  setLastSessionId: (id) =>
    set((s) => ({ session: { ...s.session, lastSessionId: id } })),

  setClientSessionId: (id) =>
    set((s) => ({ session: { ...s.session, clientSessionId: id } })),

  setVoiceReplies: (v) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('ss_voice_replies', v ? '1' : '0');
    }
    set((s) => ({ session: { ...s.session, voiceReplies: v } }));
  },
}));
