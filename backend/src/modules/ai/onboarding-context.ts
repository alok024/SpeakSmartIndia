/**
 * Onboarding Context
 *
 * Converts onboarding data (profession + goal) into three outputs:
 *
 *   1. getOnboardingPromptContext()
 *      → System prompt injection for Aria: role-specific vocabulary,
 *        question styles, goal-aligned coaching stance.
 *
 *   2. getSessionDefaults()
 *      → Pre-filled session parameters (profession, difficulty, interview_type)
 *        derived from the user's stated goal — so the first session
 *        is already personalised without the user configuring anything.
 *
 *   3. getDashboardRecommendations()
 *      → Structured next-step suggestions for the /api/me dashboard
 *        response, driven by profession + goal + current stats.
 *
 * All outputs degrade gracefully: if onboarding is incomplete, returns ''/[].
 *
 * Goal → intent mapping
 *
 *   "get_job"        → fresher preparing for first role
 *   "switch_career"  → changing industry/function, needs bridging language
 *   "promotion"      → targeting senior/leadership interviews
 *   "improve_english"→ communication-first, role is secondary
 *   "confidence"     → performance anxiety, needs safe reps
 *   "salary_raise"   → negotiation + value articulation focus
 *
 * Profession → domain mapping
 *
 * Professions are normalised to a domain tag (software, finance, sales,
 * operations, hr, healthcare, marketing, general) for prompt selection.
 * Unknown professions fall back to 'general'.
 */

import { logger } from '../../infra/logger';
import { wrapUntrusted, UNTRUSTED_DATA_INSTRUCTION } from '../../core/utils';

const log = logger.child({ module: 'onboarding-context' });

// Types

export interface OnboardingData {
  profession?: string | null;
  goal?:       string | null;
}

export interface SessionDefaults {
  profession:     string;
  // the frontend's difficulty selector/schema use 'expert' as
  // the top tier (see frontend/types, interview/setup/page.tsx,
  // features/interview/schemas) — this must match exactly, since this
  // value is consumed directly to pre-fill that selector.
  difficulty:     'beginner' | 'intermediate' | 'expert';
  interview_type: string;
}

export interface DashboardRecommendation {
  type:    'session' | 'focus' | 'milestone';
  title:   string;
  reason:  string;
  action?: string;  // CTA label
}

interface UserStats {
  sessions:  number;
  best_score: number;
  avg_job_ready: number;
}

// Domain classification

type Domain = 'software' | 'finance' | 'sales' | 'operations' | 'hr' | 'healthcare' | 'marketing' | 'general';

const DOMAIN_KEYWORDS: Record<Domain, string[]> = {
  software:    ['software', 'developer', 'engineer', 'programmer', 'data', 'devops', 'frontend', 'backend', 'fullstack', 'mobile', 'qa', 'testing', 'machine learning', 'ai', 'cloud', 'cyber', 'it ', 'tech'],
  finance:     ['finance', 'banking', 'accountant', 'ca', 'cfa', 'investment', 'analyst', 'fintech', 'audit', 'tax', 'risk', 'equity', 'credit'],
  sales:       ['sales', 'business development', 'bd ', 'account manager', 'account executive', 'revenue', 'crm'],
  operations:  ['operations', 'supply chain', 'logistics', 'procurement', 'project manager', 'product manager', 'product management', 'scrum', 'agile', 'lean'],
  hr:          ['hr', 'human resource', 'talent', 'recruiter', 'people', 'l&d', 'payroll'],
  healthcare:  ['doctor', 'nurse', 'medical', 'pharma', 'hospital', 'clinical', 'health', 'dentist', 'therapist'],
  marketing:   ['marketing', 'brand', 'digital', 'seo', 'content', 'social media', 'growth', 'performance marketing', 'pr '],
  general:     [],
};

function classifyDomain(profession: string): Domain {
  const lower = profession.toLowerCase();
  for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS) as [Domain, string[]][]) {
    if (domain === 'general') continue;
    if (keywords.some(k => lower.includes(k))) return domain;
  }
  return 'general';
}

// Goal normalisation

type GoalType = 'get_job' | 'switch_career' | 'promotion' | 'improve_english' | 'confidence' | 'salary_raise' | 'unknown';

const GOAL_ALIASES: Record<string, GoalType> = {
  get_job:         'get_job',
  'get a job':     'get_job',
  'find a job':    'get_job',
  job:             'get_job',
  // these are the exact (lowercased) strings the profile page's
  // onboarding form actually sends — 4 of 5 didn't match any existing
  // alias and silently fell through to 'unknown', disabling goal-based
  // coaching for most users who onboard. Add the real frontend strings
  // rather than changing user-facing copy.
  'get my first job': 'get_job',
  switch_career:   'switch_career',
  'switch career': 'switch_career',
  career_change:   'switch_career',
  'switch companies': 'switch_career',
  promotion:       'promotion',
  'get promoted':  'promotion',
  improve_english: 'improve_english',
  'improve english': 'improve_english',
  english:         'improve_english',
  confidence:      'confidence',
  'build confidence': 'confidence',
  'improve confidence': 'confidence',
  // "Practice regularly" doesn't map to a dedicated GoalType — closest
  // existing fit is 'confidence' (general reps / building comfort through
  // repetition, same prompt strategy as performance-anxiety users).
  'practice regularly': 'confidence',
  salary_raise:    'salary_raise',
  'salary raise':  'salary_raise',
  'negotiate salary': 'salary_raise',
};

function normaliseGoal(raw?: string | null): GoalType {
  if (!raw) return 'unknown';
  const lower = raw.trim().toLowerCase();
  return GOAL_ALIASES[lower] ?? 'unknown';
}

// Prompt fragments

const DOMAIN_PROMPT: Record<Domain, string> = {
  software: `
[ROLE CONTEXT: SOFTWARE/TECH]
This user works in software/technology. Use tech interview conventions:
- Expect and ask about system design, coding decisions, and technical trade-offs.
- Probe for STAR answers grounded in technical outcomes (latency, uptime, scale).
- Vocabulary: sprints, PRs, CI/CD, microservices, tech debt, on-call, stakeholders.
- For feedback: evaluate whether technical claims are specific (numbers, stack, impact).`,

  finance: `
[ROLE CONTEXT: FINANCE/BANKING]
This user is in finance. Apply finance interview norms:
- Expect competency + technical questions (valuation, Excel, financial modelling).
- STAR answers should cite numbers: revenue impact, cost savings, portfolio size.
- Vocabulary: P&L, EBITDA, risk appetite, due diligence, fiduciary, compliance.
- Flag vague answers — finance interviewers expect precision.`,

  sales: `
[ROLE CONTEXT: SALES/BUSINESS DEVELOPMENT]
This user is in sales. Sales interviews prioritise metrics and persuasion:
- Probe for numbers: quota attainment %, deal size, pipeline, win rate.
- Expect answers about objection handling, prospecting, and relationship building.
- Vocabulary: pipeline, CRM, ACV, churn, upsell, closing, cold outreach.
- Evaluate whether their answers are persuasive and outcome-driven.`,

  operations: `
[ROLE CONTEXT: OPERATIONS/PRODUCT/PROJECT]
This user is in operations or project/product management:
- Expect STAR answers about cross-functional coordination, timelines, and trade-offs.
- Probe for process improvement, prioritisation, and stakeholder management.
- Vocabulary: OKRs, KPIs, roadmap, sprint, escalation, SLA, vendor management.
- Reward answers that show structured thinking and measured outcomes.`,

  hr: `
[ROLE CONTEXT: HUMAN RESOURCES]
This user is in HR. HR interviews test empathy, policy knowledge, and people skills:
- Probe for scenarios about conflict resolution, hiring, and employee relations.
- Expect answers about compliance, DEI, performance management, and culture.
- Vocabulary: attrition, headcount, HRBP, PIP, onboarding, L&D, payroll.
- Evaluate whether they balance empathy with firm policy application.`,

  healthcare: `
[ROLE CONTEXT: HEALTHCARE/MEDICAL]
This user is in healthcare. Interviews focus on patient care and clinical judgment:
- Probe for situational scenarios: handling emergencies, difficult patients, ethics.
- Expect answers that balance clinical accuracy with communication.
- Vocabulary: patient outcomes, triage, protocols, compliance, bedside manner.
- Flag any vague or overly generic answers — specifics matter in clinical contexts.`,

  marketing: `
[ROLE CONTEXT: MARKETING/GROWTH]
This user is in marketing. Marketing interviews reward creativity and data:
- Probe for campaign examples with measurable results (CTR, CAC, conversions).
- Expect answers about audience targeting, brand strategy, and channel mix.
- Vocabulary: funnel, CAC, LTV, ROI, A/B testing, positioning, attribution.
- Evaluate whether answers connect creative ideas to business outcomes.`,

  general: '',
};

const GOAL_PROMPT: Record<GoalType, string> = {
  get_job: `
[USER GOAL: LANDING FIRST/NEXT JOB]
This user wants to secure a job offer. Coaching stance:
- Focus on foundational interview skills: intro, STAR, salary questions.
- Every session should simulate a real hiring scenario.
- Be encouraging but honest — inflated scores hurt them.
- After each answer, explicitly note whether it would pass a real interview screen.`,

  switch_career: `
[USER GOAL: CAREER SWITCH]
This user is switching careers. Special coaching needed:
- Help them translate past experience into the language of the new field.
- Explicitly coach "bridging" language: how to frame transferable skills.
- Highlight what's missing vs. what's a strength-by-analogy.
- Challenge them on gaps an interviewer in the new field would probe.`,

  promotion: `
[USER GOAL: PROMOTION / SENIOR ROLE]
This user is targeting a senior/leadership position. Raise the bar:
- Probe for leadership examples, not just task execution.
- Expect answers about influence, strategy, and ambiguity — not just delivery.
- Push back if answers sound like an IC rather than a leader.
- Ask "what would you have done differently as a leader?" when answers are too tactical.`,

  improve_english: `
[USER GOAL: IMPROVING ENGLISH COMMUNICATION]
This user's primary goal is English fluency for professional settings:
- Prioritise grammar, vocabulary range, and clarity over content depth.
- After every answer, give 1–2 specific language corrections with examples.
- Celebrate improvement in sentence construction, not just content.
- Suggest better phrasings naturally — model good English in your own responses.`,

  confidence: `
[USER GOAL: BUILDING CONFIDENCE]
This user struggles with confidence in interviews. Coaching stance:
- Be warm, safe, and encouraging — never harsh.
- Start sessions with easier questions to build momentum.
- Celebrate small wins loudly. Frame all feedback as "here's how to make a great answer even better."
- Avoid piling on multiple corrections — pick ONE thing to improve at a time.`,

  salary_raise: `
[USER GOAL: SALARY NEGOTIATION / RAISE]
This user wants to negotiate a raise or higher starting salary:
- Focus sessions on value articulation: how to quantify impact in rupees/%.
- Practice salary discussion scenarios, including pushback and silence.
- Coach confident, non-apologetic language around compensation.
- Teach anchoring: always name a number first, with rationale.`,

  unknown: '',
};

// Session defaults per goal + domain

function computeDifficulty(goal: GoalType, sessions: number): 'beginner' | 'intermediate' | 'expert' {
  if (goal === 'promotion') return sessions < 5 ? 'intermediate' : 'expert';
  if (goal === 'confidence') return 'beginner';
  if (sessions === 0) return 'beginner';
  if (sessions < 10) return 'intermediate';
  return 'expert';
}

function computeInterviewType(goal: GoalType, domain: Domain): string {
  if (goal === 'improve_english') return 'behavioral';
  if (goal === 'salary_raise')    return 'behavioral';
  if (goal === 'confidence')      return 'behavioral';
  if (goal === 'promotion')       return 'leadership';
  if (domain === 'software')      return 'technical';
  if (domain === 'finance')       return 'technical';
  return 'mixed';
}

// 1. Prompt context

// Coarse persona bucket — used to partition the AI response cache
// so that cached answers stay relevant to a user's profession/goal
// instead of erasing onboarding personalisation on a cache hit.

export function getPersonaBucket(onboarding: OnboardingData): string {
  if (!onboarding.profession && !onboarding.goal) return '';
  const domain   = onboarding.profession ? classifyDomain(onboarding.profession) : 'general';
  const goalType = normaliseGoal(onboarding.goal);
  return `${domain}:${goalType}`;
}

export function getOnboardingPromptContext(onboarding: OnboardingData): string {
  const { profession, goal } = onboarding;
  if (!profession && !goal) return '';

  const domain     = profession ? classifyDomain(profession) : 'general';
  const goalType   = normaliseGoal(goal);

  const professionLine = profession
    ? `\n[USER PROFILE] Profession: ${wrapUntrusted(profession)}. Tailor all questions, vocabulary, and examples to this role. ${UNTRUSTED_DATA_INSTRUCTION}`
    : '';

  const domainBlock = DOMAIN_PROMPT[domain];
  const goalBlock   = GOAL_PROMPT[goalType];

  const result = professionLine + domainBlock + goalBlock;

  log.debug('Onboarding context built', { domain, goalType, length: result.length });

  return result;
}

// 2. Session defaults

export function getSessionDefaults(
  onboarding: OnboardingData,
  sessions = 0
): SessionDefaults {
  const domain   = onboarding.profession ? classifyDomain(onboarding.profession) : 'general';
  const goalType = normaliseGoal(onboarding.goal);

  return {
    profession:     onboarding.profession || 'General',
    difficulty:     computeDifficulty(goalType, sessions),
    interview_type: computeInterviewType(goalType, domain),
  };
}

// 3. Dashboard recommendations

export function getDashboardRecommendations(
  onboarding: OnboardingData,
  stats: UserStats
): DashboardRecommendation[] {
  const recs: DashboardRecommendation[] = [];
  const goalType = normaliseGoal(onboarding.goal);
  const profession = onboarding.profession || 'your field';

  // Goal-specific primary recommendation
  if (goalType === 'get_job' && stats.sessions < 5) {
    recs.push({
      type:   'session',
      title:  'Start your interview prep',
      reason: `You want to land a ${profession} job. Complete 5 sessions to build interview muscle memory.`,
      action: 'Start Practice',
    });
  }

  if (goalType === 'switch_career') {
    recs.push({
      type:   'focus',
      title:  'Practice bridging your experience',
      reason: `Career switchers often lose interviewers early. Practice framing your past ${profession} experience in language the new field understands.`,
      action: 'Practice Behavioral',
    });
  }

  if (goalType === 'promotion' && stats.avg_job_ready < 70) {
    recs.push({
      type:   'focus',
      title:  'Level up to leadership answers',
      reason: `Your current score suggests IC-level answers. Senior roles expect you to talk about influence, not just execution.`,
      action: 'Try Leadership Mode',
    });
  }

  if (goalType === 'improve_english') {
    recs.push({
      type:   'focus',
      title:  'Focus on grammar & vocabulary',
      reason: `Every session gives you live English corrections. Aim for 0 grammar errors per answer — you're building a real habit.`,
      action: 'Start Session',
    });
  }

  if (goalType === 'confidence' && stats.sessions < 3) {
    recs.push({
      type:   'session',
      title:  'Your first 3 sessions are the hardest',
      reason: `Confidence comes from reps, not reading. Complete 3 easy sessions — Aria will keep it safe.`,
      action: 'Easy Start',
    });
  }

  if (goalType === 'salary_raise') {
    recs.push({
      type:   'focus',
      title:  'Practice your value pitch',
      reason: `Salary negotiation is a skill. Use sessions to practice quantifying your impact before your next conversation.`,
      action: 'Practice Negotiation',
    });
  }

  // Milestone nudges based on stats
  if (stats.sessions === 0) {
    recs.push({
      type:   'milestone',
      title:  'Complete your first session',
      reason: `You've set up your profile${profession !== 'your field' ? ` as a ${profession}` : ''}. One session gives Aria enough to personalise your coaching.`,
      action: 'Begin',
    });
  } else if (stats.sessions >= 1 && stats.sessions < 5 && stats.best_score < 60) {
    recs.push({
      type:   'focus',
      title:  'Work on your answer structure',
      reason: `Your early scores suggest answers lack clear structure. Try the STAR method: Situation → Task → Action → Result.`,
      action: 'STAR Practice',
    });
  } else if (stats.avg_job_ready >= 75) {
    recs.push({
      type:   'milestone',
      title:  'You\'re interview-ready',
      reason: `Your job-readiness score is ${Math.round(stats.avg_job_ready)}. Now push for consistency — don't let it slip.`,
      action: 'Advanced Session',
    });
  }

  return recs.slice(0, 3); // cap at 3 recommendations
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. UPSC DAF (Detailed Application Form) context
//
// Injected into Aria's system prompt for UPSC Civil Services sessions only.
// Enables highly personalised questions that mirror real DPIIT/UPSC interview
// boards: "You've mentioned mountaineering as a hobby — how does that shape
// your approach to challenges in administration?"
//
// Each field is optional. If the user hasn't filled DAF data yet, returns ''
// so the session degrades gracefully to generic UPSC prep.
// ─────────────────────────────────────────────────────────────────────────────

export interface DAFData {
  name?:               string | null;
  home_state?:         string | null;
  graduation_subject?: string | null;
  graduation_college?: string | null;
  optional_subject?:   string | null;
  hobbies?:            string | null;  // comma-separated, max 3
  work_experience?:    string | null;
  extracurriculars?:   string | null;
}

export function getDAFPromptContext(daf: DAFData | null | undefined): string {
  if (!daf) return '';

  const lines: string[] = [];

  if (daf.name)               lines.push(`Name: ${wrapUntrusted(daf.name)}`);
  if (daf.home_state)         lines.push(`Home State: ${wrapUntrusted(daf.home_state)}`);
  if (daf.graduation_subject) lines.push(`Graduation Subject: ${wrapUntrusted(daf.graduation_subject)}`);
  if (daf.graduation_college) lines.push(`Graduation College/University: ${wrapUntrusted(daf.graduation_college)}`);
  if (daf.optional_subject)   lines.push(`UPSC Optional Subject: ${wrapUntrusted(daf.optional_subject)}`);

  if (daf.hobbies) {
    const hobbies = daf.hobbies.split(',').map(h => h.trim()).filter(Boolean).slice(0, 3);
    if (hobbies.length > 0) lines.push(`Hobbies: ${hobbies.map(h => wrapUntrusted(h)).join(', ')}`);
  }

  if (daf.work_experience)  lines.push(`Work Experience: ${wrapUntrusted(daf.work_experience)}`);
  if (daf.extracurriculars) lines.push(`Extra-curriculars / Achievements: ${wrapUntrusted(daf.extracurriculars)}`);

  if (lines.length === 0) return '';

  const hobbiesGuidance = daf.hobbies
    ? `- For each listed hobby, prepare at least one question that connects it to public service, character, or administrative challenges.`
    : '';

  const optionalGuidance = daf.optional_subject
    ? `- The candidate's optional subject is ${wrapUntrusted(daf.optional_subject)}. Ask how this academic discipline informs their policy views or administrative approach.`
    : '';

  return `

[UPSC DAF PROFILE — PERSONALISED BOARD SIMULATION]
The candidate's DAF (Detailed Application Form) details are listed below. ${UNTRUSTED_DATA_INSTRUCTION}
Use these facts exactly as a real UPSC interview board would — weave them into questions naturally rather than listing them back verbatim.

${lines.join('\n')}

BOARD QUESTIONING GUIDANCE:
- Ground 30–40% of questions directly in this DAF data.
- Ask how the candidate's background (state, college, optional) shapes their worldview.
${hobbiesGuidance}
${optionalGuidance}
- For work experience: ask about lessons learned and how they apply to governance.
- For extra-curriculars: probe character, leadership, and team skills.
- Never ask about something not in the DAF — invent nothing.
- Vary the angle: don't ask "tell me about your hobby" twice in the same session.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Company-specific campus interview mode
//
// Activated when the user selects a company target on the setup screen.
// Shifts Aria's question pattern to match that company's known interview
// format: Amazon = all 16 Leadership Principles in STAR format,
// Google = Googleyness + structured problem-solving, etc.
// ─────────────────────────────────────────────────────────────────────────────

export type CompanyMode =
  | 'tcs'
  | 'infosys'
  | 'wipro'
  | 'accenture'
  | 'amazon'
  | 'google'
  | 'flipkart';

const COMPANY_PROMPT: Record<CompanyMode, string> = {
  tcs: `
[COMPANY MODE: TCS]
This session simulates a TCS campus interview. Follow TCS's known format:
- Values-based questions: integrity, teamwork, commitment to continuous learning.
- Technical basics: OOPs concepts, basic data structures, SQL fundamentals.
- HR round staples: "Why TCS?", "Where do you see yourself in 5 years?", strengths/weaknesses.
- Tone: formal but friendly. TCS interviewers are rarely aggressive — probe for clarity, not stress.
- Avoid advanced system-design or algorithm-heavy questions; TCS recruits broadly from all CS streams.`,

  infosys: `
[COMPANY MODE: INFOSYS]
This session simulates an Infosys InfyTQ-style campus interview:
- Aptitude focus: logical reasoning, quantitative problems, basic coding in Java/Python.
- Technical round: data structures (arrays, linked lists, sorting), DBMS, OS basics.
- HR round: communication skills, adaptability, team scenarios, "Tell me about yourself."
- InfyTQ certification holders get a shorter technical round — ask the candidate if they hold it.
- Emphasis on clear, structured communication over depth of knowledge.`,

  wipro: `
[COMPANY MODE: WIPRO]
This session simulates Wipro's WILP/WASE-pattern campus interview:
- Written aptitude first (simulated verbally): verbal ability, logical reasoning, quant.
- Technical: programming basics, OOPs, data structures, any one language the candidate knows.
- Coding round: 1–2 easy problems (FizzBuzz level to array manipulation).
- HR: career goals, relocation willingness, situational questions ("Tell me about a challenge you faced").
- WASE candidates: expect engineering-specific questions in their chosen stream alongside CS basics.`,

  accenture: `
[COMPANY MODE: ACCENTURE]
This session simulates an Accenture campus interview. Accenture is communication-heavy:
- Cognitive and personality assessment (simulated): pattern recognition, verbal reasoning.
- Communication skills are the #1 filter — evaluate clarity, fluency, and confidence in every answer.
- Behavioral round: situational questions using STAR format, teamwork scenarios, leadership examples.
- Technical is lightweight: basic programming concepts, no advanced DSA.
- Culture fit: "Why Accenture?", "Tell me about a time you showed initiative."`,

  amazon: `
[COMPANY MODE: AMAZON — LEADERSHIP PRINCIPLES]
This session simulates an Amazon interview. Every question must map to one of Amazon's 16 Leadership Principles:
Customer Obsession, Ownership, Invent and Simplify, Are Right A Lot, Learn and Be Curious, Hire and Develop the Best, Insist on the Highest Standards, Think Big, Bias for Action, Frugality, Earn Trust, Dive Deep, Have Backbone; Disagree and Commit, Deliver Results, Strive to be Earth's Best Employer, Success and Scale Bring Broad Responsibility.

INTERVIEWING RULES:
- Ask all questions in STAR format: "Tell me about a time when…"
- After each answer, probe with: "What would you do differently?" or "What was the outcome?"
- Rotate through different Leadership Principles — never repeat one in the same session.
- Flag answers that are vague, hypothetical ("I would…" instead of "I did…"), or lack a measurable result.
- The bar is high. A weak STAR answer should be called out directly with guidance on what "good" looks like.`,

  google: `
[COMPANY MODE: GOOGLE]
This session simulates a Google campus/SWE interview:
- Googleyness + Leadership: "Tell me about a time you disagreed with your team." "Describe a situation where you had to learn something quickly." "How do you handle ambiguity?"
- Structured problem-solving: present open-ended problems and evaluate clarity of thinking, not just the final answer.
- Collaborative tone: Google interviewers are coaches, not inquisitors — mirror that style.
- Coding (for SWE): algorithm problems with clear communication of approach before writing code.
- "Why Google?" must include specific teams, products, or research — generic answers fail.
- Evaluate both the answer AND how the candidate thinks through it; process > result.`,

  flipkart: `
[COMPANY MODE: FLIPKART]
This session simulates a Flipkart campus interview:
- Product sense: "How would you improve Flipkart's search experience?" "Design a returns flow for Tier-3 cities."
- Operations scenarios: supply chain trade-offs, last-mile delivery challenges, seller onboarding friction.
- Data-driven thinking: ask for metrics, north-star KPIs, A/B test design.
- Behavioral: STAR format but with emphasis on speed of execution and 0→1 ownership.
- For tech roles: system design with scale in mind (India-level traffic during Big Billion Days).
- Cultural fit: bias for action, comfort with ambiguity, startup mindset despite scale.`,
};

export function getCompanyModePromptContext(companyMode: string | null | undefined): string {
  if (!companyMode) return '';
  const prompt = COMPANY_PROMPT[companyMode as CompanyMode];
  return prompt ?? '';
}

