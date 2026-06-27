/**
 * modules/elara/elara.service.ts
 *
 * AI logic for Elara's two post-session features:
 *
 *  generateDebrief() — Pro+
 *    ~200-word spoken debrief synthesised from the session's per-answer
 *    feedbacks. Filler count is derived locally (same countFillers() logic
 *    used by speechApi.save) so the model cannot hallucinate this number.
 *    Returns structured JSON ready to feed into voiceApi.tts().
 *
 *  generateAudit() — Elite
 *    Sends all answers in a single batch call to find cross-session patterns
 *    rather than isolated per-answer errors. Optionally appends Hinglish
 *    explanations for each pattern via a second AI call when elara_hindi_pref
 *    is on. The second call is fire-and-forget with try/catch — it never
 *    blocks the English audit.
 *
 * Both use callAI() directly (not the HTTP layer) to inherit provider
 * failover, circuit breaking, and the burst limiter automatically.
 */

import { callAI } from '../ai/ai.service';

export interface AnswerEntry {
  question: string;
  answer:   string;
  score:    number;
  corrections?: Array<{ wrong: string; correct: string; rule?: string }>;
}

export interface DebriefResult {
  summary:       string;   // 2-3 sentence spoken intro
  top_patterns:  string[]; // up to 3 grammar pattern labels
  filler_count:  number;   // computed client-side, echoed into the response
  vocab_range:   'basic' | 'intermediate' | 'advanced';
  focus_next:    string;   // one actionable takeaway
}

export interface AuditPattern {
  pattern:     string;  // e.g. "Passive voice misuse"
  examples:    string[]; // actual answer snippets
  count:       number;
  hindi_explanation?: string; // present when elara_hindi_pref is on
}

export interface AuditResult {
  filler_estimate:   number;
  top_patterns:      AuditPattern[];
  vocab_range:       'basic' | 'intermediate' | 'advanced';
  fluency_rating:    number;  // 1–10
  priority_exercise: string;  // one concrete practice exercise
}

// Counts filler words across a set of answer strings.
// Mirrors countFillers() in frontend/lib/speech-analysis.ts intentionally
// so we get a consistent number on both client and server without an import.
const FILLER_RE = /\b(um+|uh+|like|basically|actually|you know|right|so+|well|kind of|sort of)\b/gi;

function countFillers(answers: string[]): number {
  return answers.reduce((acc, a) => {
    const m = a.match(FILLER_RE);
    return acc + (m ? m.length : 0);
  }, 0);
}

// ---------------------------------------------------------------------------
// generateDebrief — Pro+ (called at session end, spoken aloud by Elara)
// ---------------------------------------------------------------------------
export async function generateDebrief(
  entries:      AnswerEntry[],
  hindiPref:    boolean,
): Promise<DebriefResult> {
  const fillerCount = countFillers(entries.map(e => e.answer));

  const entryBlock = entries.map((e, i) =>
    `Q${i + 1}: ${e.question}\nAnswer: ${e.answer}\nScore: ${e.score}/10` +
    (e.corrections?.length
      ? `\nErrors: ${e.corrections.map(c => `"${c.wrong}" → "${c.correct}"`).join(', ')}`
      : '')
  ).join('\n\n');

  const languageInstruction = hindiPref
    ? 'Write the summary field in natural Hinglish (mix Hindi and English naturally). All other fields stay in English.'
    : 'Write all fields in clear, spoken Indian English.';

  const systemPrompt = `You are Elara, an English coach on the Vachix interview platform.
Analyse the candidate's session answers and produce a concise post-session debrief.
${languageInstruction}

Return ONLY a JSON object with these exact keys:
{
  "summary": "2-3 sentence spoken intro (conversational, warm, honest)",
  "top_patterns": ["pattern1", "pattern2"],   // 1-3 recurring issues, short labels
  "vocab_range": "basic|intermediate|advanced",
  "focus_next": "One specific exercise or habit for next session"
}

The filler_count will be supplied separately — do NOT include it in your JSON.
Keep summary under 60 words so TTS playback is under 30 seconds.`;

  const userMessage = `Session answers:\n\n${entryBlock}\n\nFiller words detected: ${fillerCount}`;

  const aiResp = await callAI(
    [
      { role: 'system',    content: systemPrompt },
      { role: 'user',      content: userMessage },
    ],
    512,
    { cacheable: false }
  );

  let parsed: Omit<DebriefResult, 'filler_count'>;
  try {
    const clean = aiResp.text.replace(/```json|```/g, '').trim();
    parsed = JSON.parse(clean);
  } catch {
    // Graceful fallback so a JSON parse failure never crashes the session end
    parsed = {
      summary:      'Great session! You showed good structure in most answers.',
      top_patterns: [],
      vocab_range:  'intermediate',
      focus_next:   'Focus on reducing filler words in your next session.',
    };
  }

  return {
    ...parsed,
    filler_count: fillerCount,
    top_patterns: (parsed.top_patterns ?? []).slice(0, 3),
  };
}

// ---------------------------------------------------------------------------
// generateAudit — Elite (batch call, silent mid-session, full report at end)
// ---------------------------------------------------------------------------
export async function generateAudit(
  entries:   AnswerEntry[],
  hindiPref: boolean,
): Promise<AuditResult> {
  const fillerCount = countFillers(entries.map(e => e.answer));

  const entryBlock = entries.map((e, i) =>
    `Q${i + 1}: ${e.question}\nAnswer: ${e.answer}`
  ).join('\n\n');

  const systemPrompt = `You are Elara, an expert English coach.
Analyse all answers as a single corpus to find patterns across the session.

Return ONLY a JSON object:
{
  "top_patterns": [
    {
      "pattern": "short pattern name",
      "examples": ["quoted snippet from answers"],
      "count": 2
    }
  ],
  "vocab_range": "basic|intermediate|advanced",
  "fluency_rating": 7,
  "priority_exercise": "One concrete exercise"
}

Rules:
- top_patterns: 2-5 entries, most frequent first
- fluency_rating: 1-10 integer
- examples: actual quotes from the answers, not paraphrases
- priority_exercise: one paragraph, actionable, specific`;

  const userMessage = `Session answers (${entries.length} questions):\n\n${entryBlock}`;

  const aiResp = await callAI(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userMessage },
    ],
    800,
    { cacheable: false }
  );

  let parsed: Omit<AuditResult, 'filler_estimate'>;
  try {
    const clean = aiResp.text.replace(/```json|```/g, '').trim();
    parsed = JSON.parse(clean);
  } catch {
    parsed = {
      top_patterns:      [],
      vocab_range:       'intermediate',
      fluency_rating:    6,
      priority_exercise: 'Record yourself answering one question and listen back for filler words.',
    };
  }

  // Optional second AI call: append Hindi explanations per pattern
  if (hindiPref && parsed.top_patterns?.length) {
    try {
      const hindiPrompt = `For each English grammar pattern below, write one sentence of explanation in natural Hinglish (mix Hindi + English).
Return ONLY a JSON array of strings, one per pattern, in the same order.

Patterns:\n${parsed.top_patterns.map((p, i) => `${i + 1}. ${p.pattern}`).join('\n')}`;

      const hindiResp = await callAI(
        [{ role: 'user', content: hindiPrompt }],
        300,
        { cacheable: false }
      );

      const hindiClean = hindiResp.text.replace(/```json|```/g, '').trim();
      const hindiLines: string[] = JSON.parse(hindiClean);
      parsed.top_patterns = parsed.top_patterns.map((p, i) => ({
        ...p,
        hindi_explanation: hindiLines[i] ?? undefined,
      }));
    } catch {
      // Hindi explanations are additive — never block the English audit
    }
  }

  return {
    ...parsed,
    filler_estimate: fillerCount,
    top_patterns: (parsed.top_patterns ?? []).slice(0, 5),
  };
}
