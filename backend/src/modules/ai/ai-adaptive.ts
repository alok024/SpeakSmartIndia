/**
 * Adaptive AI Behavior — Phase 9
 *
 * "You built intelligence. But not behavior adaptation."
 *
 * Problem: every user gets the same Aria regardless of:
 *   - How many sessions they've done (beginner vs veteran)
 *   - Their current score trajectory (improving vs plateauing)
 *   - Their biggest weak area (grammar vs structure vs confidence)
 *   - Their streak / engagement level
 *
 * This module computes a BehaviorProfile from user stats and returns
 * a prompt injection that personalises Aria's coaching style.
 *
 * Adaptation dimensions
 *
 *  1. DEPTH (based on session count)
 *     < 5 sessions  → Beginner mode: simple language, more encouragement
 *     5–20 sessions → Intermediate: balanced feedback, expand vocabulary
 *     > 20 sessions → Advanced: direct, technical, push harder
 *
 *  2. TRAJECTORY (based on score trend over last 5 sessions)
 *     Improving  → reinforce what's working, introduce harder challenges
 *     Plateauing → identify the specific blocker, switch focus
 *     Declining  → reduce complexity, rebuild confidence
 *
 *  3. FOCUS (based on lowest scoring dimension)
 *     grammar / structure / relevance / clarity → Aria explicitly
 *     calls out that dimension in every feedback
 *
 *  4. ENGAGEMENT (based on streak)
 *     streak ≥ 7  → celebrate consistency, add a challenge goal
 *     streak = 0  → gentle re-engagement, "welcome back" energy
 *
 * Usage
 *   import { getAdaptiveBehaviorContext } from './ai-adaptive';
 *
 *   // In ai.controller.ts, alongside memory + weak-area context:
 *   const adaptive = await getAdaptiveBehaviorContext(user.id, stats);
 *   const systemPrompt = BASE_SYSTEM_PROMPT + memoryContext
 *                      + weakAreaContext + adaptive;
 *
 * This is Pro/Elite only (same gate as memory context).
 */

import { logger } from '../../infra/logger';

const log = logger.child({ module: 'ai-adaptive' });

// Input types

export interface UserStats {
  sessions:        number;
  streak:          number;
  best_score:      number;
  avg_job_ready:   number;
  clarity_avg:     number;
  structure_avg:   number;
  relevance_avg:   number;
  grammar_avg:     number;
  recent_scores?:  number[];   // last 5, oldest first
}

// Dimension helpers

type DepthLevel    = 'beginner' | 'intermediate' | 'advanced';
type Trajectory    = 'improving' | 'plateauing' | 'declining';
type WeakDimension = 'grammar' | 'structure' | 'relevance' | 'clarity' | 'none';

function computeDepth(sessions: number): DepthLevel {
  if (sessions < 5)  return 'beginner';
  if (sessions < 20) return 'intermediate';
  return 'advanced';
}

function computeTrajectory(recentScores?: number[]): Trajectory {
  if (!recentScores || recentScores.length < 3) return 'plateauing';
  const n    = recentScores.length;
  const half = Math.floor(n / 2);
  const early = recentScores.slice(0, half).reduce((a, b) => a + b, 0) / half;
  const late  = recentScores.slice(-half).reduce((a, b) => a + b, 0) / half;
  const delta = late - early;
  if (delta >  3) return 'improving';
  if (delta < -3) return 'declining';
  return 'plateauing';
}

function computeWeakDimension(stats: UserStats): WeakDimension {
  const dims: Array<[WeakDimension, number]> = [
    ['grammar',   stats.grammar_avg],
    ['structure', stats.structure_avg],
    ['relevance', stats.relevance_avg],
    ['clarity',   stats.clarity_avg],
  ];
  const valid = dims.filter(([, v]) => v > 0);
  if (valid.length === 0) return 'none';
  valid.sort(([, a], [, b]) => a - b);
  const [weakest, score] = valid[0];
  return score < 6 ? weakest : 'none'; // only flag if genuinely weak
}

// Prompt fragments per dimension

// Fix (S2): Compacted from prose paragraphs (~38 tok each) to directive lists
// (~16 tok each). LLMs parse these equally well — the trimmed words did no
// semantic work.
const DEPTH_PROMPT: Record<DepthLevel, string> = {
  beginner:     `\n[STYLE: beginner] Simple language. Max 1-2 corrections. End with specific praise.`,
  intermediate: `\n[STYLE: intermediate] Balance encouragement + directness. Note 2-3 improvements. Add field vocabulary where natural.`,
  advanced:     `\n[STYLE: advanced] Direct, technical, no fluff. Push for stronger phrasing. Treat as senior candidate.`,
};

// Fix (S2): Compacted trajectory prompts.
const TRAJECTORY_PROMPT: Record<Trajectory, string> = {
  improving:  `\n[TRAJECTORY: improving] Reinforce what's working. Add one stretch goal this session.`,
  plateauing: `\n[TRAJECTORY: plateauing] Name the specific blocker. Focus the session on breaking through it.`,
  declining:  `\n[TRAJECTORY: declining] Don't pile on. Praise first, one correction only. Rebuild confidence.`,
};

// Fix (S2): Compacted focus prompts.
const FOCUS_PROMPT: Record<WeakDimension, string> = {
  grammar:   `\n[FOCUS: grammar] Every feedback: one grammar fix with corrected form.`,
  structure: `\n[FOCUS: structure] Every feedback: label whether answer had clear opening/body/conclusion (STAR).`,
  relevance: `\n[FOCUS: relevance] Every feedback: judge whether they directly answered what was asked.`,
  clarity:   `\n[FOCUS: clarity] Every feedback: note if main point was clear within first two sentences.`,
  none:      '',
};

// Fix (S2): Compacted streak prompts.
function streakPrompt(streak: number): string {
  if (streak >= 14) return `\n[STREAK: ${streak} days 🔥] Acknowledge briefly. Set an ambitious challenge.`;
  if (streak >= 7)  return `\n[STREAK: ${streak} days] Acknowledge briefly, keep momentum.`;
  if (streak === 0) return `\n[RETURNING USER] Welcoming, not critical. Start easy.`;
  return '';
}

// Main export

export interface BehaviorProfile {
  depth:      DepthLevel;
  trajectory: Trajectory;
  weakDim:    WeakDimension;
  streak:     number;
  // Human-readable labels — sent to the frontend so the UI can show
  // "Aria adapted for you" context without any additional computation.
  coaching_context: {
    depth_label:      string;   // e.g. "Beginner coaching"
    trajectory_label: string;   // e.g. "You're improving 📈"
    focus_label:      string | null;  // e.g. "Focus: Grammar" — null if no weak area
    streak_label:     string | null;  // e.g. "7-day streak 🔥" — null if no streak signal
  };
}

// Human-readable label maps (for frontend display)

const DEPTH_LABEL: Record<DepthLevel, string> = {
  beginner:     'Beginner coaching',
  intermediate: 'Intermediate coaching',
  advanced:     'Advanced coaching',
};

const TRAJECTORY_LABEL: Record<Trajectory, string> = {
  improving:  "You're improving \u{1F4C8}",
  plateauing: 'Consistency mode',
  declining:  'Rebuilding confidence',
};

const FOCUS_LABEL: Record<WeakDimension, string | null> = {
  grammar:   'Focus: Grammar',
  structure: 'Focus: Answer structure',
  relevance: 'Focus: Staying on-point',
  clarity:   'Focus: Clarity',
  none:      null,
};

function streakLabel(streak: number): string | null {
  if (streak >= 14) return `${streak}-day streak \u{1F525}`;
  if (streak >= 7)  return `${streak}-day streak \u{1F525}`;
  return null;
}

/**
 * Returns { prompt, profile } for Pro/Elite users.
 *
 * prompt  — appended to the system prompt (existing behaviour, unchanged)
 * profile — structured object sent to the frontend so the UI can display
 *           "Aria adapted for you" signals without any additional computation
 */
export function getAdaptiveBehaviorContext(stats: UserStats): {
  prompt:  string;
  profile: BehaviorProfile;
} {
  const depth      = computeDepth(stats.sessions);
  const trajectory = computeTrajectory(stats.recent_scores);
  const weakDim    = computeWeakDimension(stats);

  const coaching_context = {
    depth_label:      DEPTH_LABEL[depth],
    trajectory_label: TRAJECTORY_LABEL[trajectory],
    focus_label:      FOCUS_LABEL[weakDim],
    streak_label:     streakLabel(stats.streak),
  };

  const profile: BehaviorProfile = { depth, trajectory, weakDim, streak: stats.streak, coaching_context };

  log.debug('Adaptive behavior profile computed', profile);

  const prompt =
    DEPTH_PROMPT[depth] +
    TRAJECTORY_PROMPT[trajectory] +
    FOCUS_PROMPT[weakDim] +
    streakPrompt(stats.streak);

  return { prompt, profile };
}
