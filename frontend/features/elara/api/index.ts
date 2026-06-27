/**
 * features/elara/api/index.ts
 *
 * Typed HTTP client for all Elara endpoints.
 */

import { apiCall } from '@/lib/api';

// ── Shared types ────────────────────────────────────────────────────────────

export interface AnswerEntry {
  question:    string;
  answer:      string;
  score:       number;
  corrections?: Array<{ wrong: string; correct: string; rule?: string }>;
}

export interface DebriefResult {
  summary:      string;
  top_patterns: string[];
  filler_count: number;
  vocab_range:  'basic' | 'intermediate' | 'advanced';
  focus_next:   string;
}

export interface AuditPattern {
  pattern:             string;
  examples:            string[];
  count:               number;
  hindi_explanation?:  string;
}

export interface AuditResult {
  filler_estimate:   number;
  top_patterns:      AuditPattern[];
  vocab_range:       'basic' | 'intermediate' | 'advanced';
  fluency_rating:    number;
  priority_exercise: string;
}

export interface ElaraPrefs {
  elara_hindi_pref: boolean;
}

export interface ElaraSessionRecord {
  id?:              string;
  user_id:          string;
  client_session_id: string;
  grammar_score?:   number | null;
  fluency_score?:   number | null;
  vocab_score?:     number | null;
  message_count:    number;
  mode:             string;
  created_at?:      string;
}

export interface VocabWord {
  id?:              string;
  wrong_form:       string;
  correct_form:     string;
  rule?:            string | null;
  occurrences:      number;
  auto_saved:       boolean;
  manually_saved:   boolean;
  created_at?:      string;
}

export interface VocabError {
  wrong:   string;
  correct: string;
  rule?:   string;
}

// ── API client ───────────────────────────────────────────────────────────────

export const elaraApi = {
  /** Pro+ — post-session spoken debrief */
  debrief: (answers: AnswerEntry[]) =>
    apiCall<DebriefResult>('/elara/debrief', 'POST', { answers }),

  /** Elite — full batch session audit */
  audit: (answers: AnswerEntry[]) =>
    apiCall<AuditResult>('/elara/audit', 'POST', { answers }),

  /** Any authed user — read Hindi pref */
  getPrefs: () =>
    apiCall<ElaraPrefs>('/elara/prefs', 'GET'),

  /** Elite — write Hindi pref */
  setHindiPref: (enabled: boolean) =>
    apiCall<ElaraPrefs>('/elara/prefs', 'PATCH', { elara_hindi_pref: enabled }),

  // ── Session persistence ─────────────────────────────────────────────────

  /** Pro+ — save conversation scores when conversation ends */
  saveSession: (payload: {
    client_session_id: string;
    grammar_score:     number | null;
    fluency_score:     number | null;
    vocab_score:       number | null;
    message_count:     number;
    mode:              string;
  }) => apiCall<{ saved: boolean }>('/elara/sessions', 'POST', payload),

  /** Pro+ — English Journey chart data */
  getSessions: (limit = 60) =>
    apiCall<{ sessions: ElaraSessionRecord[] }>(`/elara/sessions?limit=${limit}`, 'GET'),

  // ── Vocabulary tracker ──────────────────────────────────────────────────

  /** Pro+ — get saved vocab list (dashboard + /english sidebar) */
  getVocab: () =>
    apiCall<{ words: VocabWord[] }>('/elara/vocab', 'GET'),

  /** Pro+ — manually save a word (user tapped it) */
  saveWord: (wrong_form: string, correct_form: string, rule?: string) =>
    apiCall<{ saved: boolean }>('/elara/vocab/save', 'POST', { wrong_form, correct_form, rule }),

  /** Pro+ — track errors flagged in a message (fire-and-forget) */
  trackErrors: (errors: VocabError[], session_id?: string) =>
    apiCall<{ tracked: boolean }>('/elara/vocab/track', 'POST', { errors, session_id }),

  /** Pro+ — get reinforcement block to inject into system prompt */
  getVocabPrompt: () =>
    apiCall<{ prompt_block: string }>('/elara/vocab/prompt', 'GET'),
};
