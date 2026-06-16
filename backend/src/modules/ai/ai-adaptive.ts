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
 * ── Adaptation dimensions ─────────────────────────────────────────
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
 * ── Usage ─────────────────────────────────────────────────────────
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

// ── Input types ───────────────────────────────────────────────────

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

// ── Dimension helpers ─────────────────────────────────────────────

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

// ── Prompt fragments per dimension ────────────────────────────────

const DEPTH_PROMPT: Record<DepthLevel, string> = {
  beginner: `
[COACHING STYLE: BEGINNER]
This user is new (< 5 sessions). Use simple, encouraging language.
Avoid overwhelming them with too many corrections at once — pick the TOP 1–2 improvements.
Always end with specific praise for something they did well.`,

  intermediate: `
[COACHING STYLE: INTERMEDIATE]
This user has some experience. Balance encouragement with directness.
Point out 2–3 specific improvements. Introduce industry-relevant vocabulary where natural.`,

  advanced: `
[COACHING STYLE: ADVANCED]
This is an experienced user. Be direct and technical — no need for excessive encouragement.
Push them: note missed opportunities, suggest stronger phrasing, raise the bar.
Treat them as a professional preparing for senior/competitive roles.`,
};

const TRAJECTORY_PROMPT: Record<Trajectory, string> = {
  improving: `
[TRAJECTORY: IMPROVING]
The user's scores are trending upward. Reinforce what's working.
Introduce one harder challenge or stretch goal per session.`,

  plateauing: `
[TRAJECTORY: PLATEAUING]
The user's scores have levelled off. Identify the specific blocker holding them back.
Name it explicitly and focus this session on breaking through it.`,

  declining: `
[TRAJECTORY: DECLINING]
The user's recent scores have dipped. Do not pile on — rebuild confidence first.
Simplify your feedback. Find something to genuinely praise before correcting.`,
};

const FOCUS_PROMPT: Record<WeakDimension, string> = {
  grammar:   `\n[FOCUS AREA: GRAMMAR] This user struggles with grammar. In EVERY feedback, highlight one grammar fix with the corrected form.`,
  structure: `\n[FOCUS AREA: STRUCTURE] This user struggles with answer structure (STAR/PREP). In EVERY feedback, explicitly label whether their answer had a clear opening, body, and conclusion.`,
  relevance: `\n[FOCUS AREA: RELEVANCE] This user's answers often miss the point of the question. In EVERY feedback, judge whether they directly addressed what was asked.`,
  clarity:   `\n[FOCUS AREA: CLARITY] This user struggles with clarity. In EVERY feedback, note whether their main point was clear within the first two sentences.`,
  none:      '',
};

function streakPrompt(streak: number): string {
  if (streak >= 14) return `\n[ENGAGEMENT: ON FIRE 🔥] ${streak}-day streak. Acknowledge this briefly. Set an ambitious challenge this session.`;
  if (streak >= 7)  return `\n[ENGAGEMENT: CONSISTENT] ${streak}-day streak. Acknowledge briefly and keep momentum going.`;
  if (streak === 0) return `\n[ENGAGEMENT: RETURNING USER] The user is returning after a break. Be welcoming, not critical. Start easy.`;
  return '';
}

// ── Main export ───────────────────────────────────────────────────

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

// ── Human-readable label maps (for frontend display) ─────────────

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
