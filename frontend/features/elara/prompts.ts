
export type ElaraMode = 'conversation' | 'topics' | 'correction' | 'vocabulary';

export function getElaraSystemPrompt(mode: ElaraMode, topic = 'daily life'): string {
  const base = `You are Elara, a warm and expert English coach for Indian learners. You specialize in fixing Indian English mistakes (subject-verb agreement, tense errors, preposition misuse, Indianisms like "do the needful", "revert back", "myself is", etc.) while being encouraging and never condescending.`;

  if (mode === 'conversation') {
    return base + `\nHave a natural flowing conversation in English on any topic the user brings up. After EVERY user message, reply in two parts:\n1. A natural conversational response (2–3 sentences).\n2. A JSON block at the end marked with ###ANALYSIS### like this:\n###ANALYSIS###\n{"errors":[{"wrong":"...", "correct":"...", "rule":"..."}], "grammar_score":<1-10>, "fluency_score":<1-10>, "vocab_score":<1-10>, "vocab_upgrade": {"basic":"...", "better":"..."}, "tip":"..."}\nIf no errors, return errors:[]. Always include scores and tip. Return ONLY the JSON after ###ANALYSIS###, nothing else after it.`;
  }
  if (mode === 'topics') {
    return base + `\nGuide the user through a structured English speaking practice on the topic: "${topic}". Ask them open questions, respond naturally, correct errors gently. After each user message:\n###ANALYSIS###\n{"errors":[{"wrong":"...", "correct":"...", "rule":"..."}], "grammar_score":<1-10>, "fluency_score":<1-10>, "vocab_score":<1-10>, "vocab_upgrade": {"basic":"...", "better":"..."}, "tip":"..."}\nAlways include scores even if perfect.`;
  }
  if (mode === 'vocabulary') {
    return base + `\nHelp the user expand their English vocabulary. When they say a word or phrase, give: the meaning, 2–3 better alternatives, example sentences, and common mistakes Indians make with it. Then invite them to use one of the words in a sentence so you can check.\nAfter their example sentence:\n###ANALYSIS###\n{"errors":[{"wrong":"...", "correct":"...", "rule":"..."}], "grammar_score":<1-10>, "fluency_score":<1-10>, "vocab_score":<1-10>, "vocab_upgrade": null, "tip":"..."}\nAlways respond naturally and encouragingly.`;
  }
  return base;
}

export function parseElaraResponse(raw: string): {
  reply: string;
  analysis: {
    errors?: Array<{ wrong: string; correct: string; rule?: string }>;
    grammar_score?: number;
    fluency_score?: number;
    vocab_score?: number;
    vocab_upgrade?: { basic: string; better: string } | null;
    tip?: string;
  } | null;
} {
  const markerIdx = raw.indexOf('###ANALYSIS###');
  if (markerIdx === -1) return { reply: raw.trim(), analysis: null };
  const reply = raw.slice(0, markerIdx).trim();
  const jsonPart = raw.slice(markerIdx + 14).trim();
  let analysis = null;
  try {
    const start = jsonPart.indexOf('{');
    const end = jsonPart.lastIndexOf('}');
    if (start !== -1 && end > start) {
      analysis = JSON.parse(jsonPart.slice(start, end + 1));
    }
  } catch {
    /* non-fatal */
  }
  return { reply, analysis };
}

// Live feedback (client-side, no API)

const FILLER_WORDS = ['um', 'uh', 'umm', 'uhh', 'like', 'basically', 'actually', 'literally', 'you know', 'i mean', 'sort of', 'kind of'];
const GRAMMAR_PATTERNS = [
  { re: /\bi am knowing\b/i, msg: '"I am knowing" → "I know"' },
  { re: /\bi am having\b/i, msg: '"I am having" → "I have"' },
  { re: /\bsince (\d+) years?\b/i, msg: '"since X years" → "for X years"' },
  { re: /\bdiscuss about\b/i, msg: '"discuss about" → "discuss"' },
  { re: /\brevert back\b/i, msg: '"revert back" → "revert" or "reply"' },
  { re: /\bi will (do|make) the needful\b/i, msg: '"do the needful" sounds dated — say what you\'ll actually do' },
  { re: /\bhe don't\b|\bshe don't\b|\bit don't\b/i, msg: '"don\'t" → "doesn\'t" after he/she/it' },
  { re: /\bhave went\b/i, msg: '"have went" → "have gone"' },
];

export interface LiveFeedbackChip {
  type: 'filler' | 'grammar' | 'ok';
  msg: string;
}

export function getLiveFeedback(text: string): LiveFeedbackChip[] {
  const trimmed = (text || '').trim();
  if (!trimmed) return [];
  const lower = ' ' + trimmed.toLowerCase().replace(/\s+/g, ' ') + ' ';
  const chips: LiveFeedbackChip[] = [];

  let fillerCount = 0;
  const seen: Record<string, number> = {};
  FILLER_WORDS.forEach((w) => {
    const re = new RegExp('\\b' + w.replace(/\s+/g, '\\s+') + '\\b', 'gi');
    const matches = lower.match(re);
    if (matches) { fillerCount += matches.length; seen[w] = matches.length; }
  });
  if (fillerCount > 0) {
    const top = Object.entries(seen).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([w, c]) => `"${w}"${c > 1 ? ` ×${c}` : ''}`).join(', ');
    chips.push({ type: 'filler', msg: `${fillerCount} filler word${fillerCount > 1 ? 's' : ''} — ${top}` });
  }

  let grammarHits = 0;
  for (const g of GRAMMAR_PATTERNS) {
    if (g.re.test(trimmed)) {
      chips.push({ type: 'grammar', msg: g.msg });
      grammarHits++;
      if (grammarHits >= 2) break;
    }
  }

  if (chips.length === 0 && trimmed.split(/\s+/).length >= 4) {
    chips.push({ type: 'ok', msg: 'Looking clean — no fillers detected' });
  }
  return chips;
}
