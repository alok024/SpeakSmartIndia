/**
 * Weekly Progress Card Service
 *
 * Generates a 1200×630 SVG progress card for each active user and
 * optionally pushes a Web Push notification linking to it.
 *
 * Called exclusively from the BullMQ 'weekly-progress-cards' job,
 * which fires every Sunday at 08:00 IST (02:30 UTC).
 *
 * Card content (enriched from P3-B baseline):
 *   - User name + plan badge
 *   - Sessions completed in the past 7 days
 *   - Average score this week vs last week (delta arrow)
 *   - Current streak
 *   - Top exam track (from active prep-path enrollment)
 *   - XP earned this week
 *   - English fluency trend arrow (derived from speech_metrics wpm delta)
 *   - Top weak area (if any)
 *
 * Voiced summary (Pro+ only):
 *   A short Elara monologue is synthesised via Sarvam TTS and stored as
 *   a Base64 WAV on users.weekly_card_voiced_url.  Served by:
 *     GET /api/weekly-card/:userId/voice
 *   The frontend fetches this on Monday morning when the user opens the app.
 *
 * Push notification:
 *   Delivered only if the user has at least one push_subscription row.
 *   Uses web-push (RFC 8030 / VAPID). On any send failure the error is
 *   logged but does not abort the card generation for that user.
 *   A 410 Gone response from the push service (subscription expired)
 *   causes the subscription row to be deleted rather than retried.
 */

import webpush from 'web-push';
import { db }  from '../../core/database/client';
import { env } from '../../core/config/env';
import { logger } from '../../infra/logger';

const log = logger.child({ module: 'weekly-card' });

// ── VAPID init ─────────────────────────────────────────────────────────────
export function initVapid(): void {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
    log.warn('VAPID keys not configured — web push notifications disabled');
    return;
  }
  webpush.setVapidDetails(
    `mailto:${env.VAPID_CONTACT_EMAIL}`,
    env.VAPID_PUBLIC_KEY,
    env.VAPID_PRIVATE_KEY,
  );
  log.info('VAPID keys configured');
}

// ── Weekly stats helpers ───────────────────────────────────────────────────

interface WeeklyStats {
  sessionsThisWeek:  number;
  avgScoreThisWeek:  number | null;
  avgScoreLastWeek:  number | null;
  streak:            number;
  topWeakArea:       string | null;
  // Enriched fields (added per feature spec)
  xpEarnedThisWeek:  number;
  topExamTrack:      string | null;   // active prep-path name, e.g. "UPSC CSE 90-Day"
  fluencyTrend:      'up' | 'down' | 'flat' | null;  // derived from speech_metrics wpm delta
}

async function getWeeklyStats(userId: string): Promise<WeeklyStats> {
  // IST = UTC+5:30
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const MS_PER_DAY    = 24 * 60 * 60 * 1000;

  const nowIST_ms            = Date.now() + IST_OFFSET_MS;
  const todayMidnightIST_ms  = nowIST_ms - (nowIST_ms % MS_PER_DAY);
  const thisWeekStartIST_ms  = todayMidnightIST_ms - 7 * MS_PER_DAY;
  const lastWeekStartIST_ms  = thisWeekStartIST_ms  - 7 * MS_PER_DAY;

  // Shift back to UTC for DB comparisons (sessions.created_at is stored in UTC).
  const thisWeekStartUTC = new Date(thisWeekStartIST_ms - IST_OFFSET_MS).toISOString();
  const lastWeekStartUTC = new Date(lastWeekStartIST_ms - IST_OFFSET_MS).toISOString();

  const [allSessions, weakAreas, stats, enrollment, speechRows] = await Promise.all([
    db.getRecentCompletedSessions(userId, 30),
    db.getWeakAreas(userId),
    db.getStats(userId),
    db.getActivePrepEnrollment(userId),
    db.getRecentSpeechMetrics(userId, 14),
  ]);

  const thisWeek = allSessions.filter(
    s => s.created_at && s.created_at >= thisWeekStartUTC
  );
  const lastWeek = allSessions.filter(
    s => s.created_at && s.created_at >= lastWeekStartUTC && s.created_at < thisWeekStartUTC
  );

  const avgOf = (rows: typeof allSessions): number | null => {
    const scored = rows.filter(s => s.score != null);
    if (!scored.length) return null;
    return scored.reduce((sum, s) => sum + (s.score ?? 0), 0) / scored.length;
  };

  // XP earned this week is already tracked on stats.xp_weekly — use it directly.
  const xpEarnedThisWeek = stats?.xp_weekly ?? 0;

  // Top exam track: derive from active prep-path enrollment name.
  // The prep_path row has a `name` field (e.g. "UPSC CSE 90-Day Plan").
  let topExamTrack: string | null = null;
  if (enrollment?.prep_path_id) {
    const path = await db.getPrepPathById(enrollment.prep_path_id);
    topExamTrack = path?.title ?? null;
  }

  // Fluency trend: compare average WPM of the last 7 speech_metrics rows
  // vs the 7 before that.  WPM is a reasonable fluency proxy — higher WPM
  // generally correlates with more natural delivery and fewer hesitations.
  // Returns null when there are fewer than 4 total rows (not enough signal).
  const fluencyTrend = computeFluencyTrend(speechRows);

  return {
    sessionsThisWeek: thisWeek.length,
    avgScoreThisWeek: avgOf(thisWeek),
    avgScoreLastWeek: avgOf(lastWeek),
    streak:           stats?.streak ?? 0,
    topWeakArea:      weakAreas[0]?.topic ?? null,
    xpEarnedThisWeek,
    topExamTrack,
    fluencyTrend,
  };
}

/**
 * Computes a fluency trend from recent speech_metrics rows.
 * Compares average WPM of the most recent half vs the earlier half.
 * Requires at least 4 rows; returns null otherwise (no signal).
 */
function computeFluencyTrend(
  rows: Array<{ wpm: number; answer_count: number }>,
): 'up' | 'down' | 'flat' | null {
  // Filter to rows that actually have WPM data (answer_count > 0 means
  // the session had real speech to analyse).
  const valid = rows.filter(r => r.answer_count > 0 && r.wpm > 0);
  if (valid.length < 4) return null;

  const half    = Math.floor(valid.length / 2);
  const recent  = valid.slice(0, half);       // rows are newest-first
  const earlier = valid.slice(half);

  const avgWpm = (arr: typeof valid) =>
    arr.reduce((s, r) => s + r.wpm, 0) / arr.length;

  const diff = avgWpm(recent) - avgWpm(earlier);
  if (Math.abs(diff) < 5) return 'flat';   // < 5 WPM delta = noise
  return diff > 0 ? 'up' : 'down';
}

// ── SVG renderer ──────────────────────────────────────────────────────────

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function fmtScore(n: number | null): string {
  if (n == null) return '—';
  return n.toFixed(1);
}

function deltaArrow(curr: number | null, prev: number | null): { symbol: string; color: string } {
  if (curr == null || prev == null) return { symbol: '', color: 'rgba(255,255,255,0.4)' };
  const diff = curr - prev;
  if (Math.abs(diff) < 0.1)       return { symbol: '→', color: 'rgba(255,255,255,0.4)' };
  if (diff > 0)                    return { symbol: '↑', color: '#4ade80' };
  return                                  { symbol: '↓', color: '#f87171' };
}

function fluencyArrow(trend: WeeklyStats['fluencyTrend']): { symbol: string; color: string; label: string } {
  switch (trend) {
    case 'up':   return { symbol: '↑', color: '#4ade80', label: 'Improving' };
    case 'down': return { symbol: '↓', color: '#f87171', label: 'Declining' };
    case 'flat': return { symbol: '→', color: 'rgba(255,255,255,0.4)', label: 'Stable' };
    default:     return { symbol: '',  color: 'rgba(255,255,255,0.3)', label: 'No data' };
  }
}

export function renderWeeklyCardSvg(
  userName:  string,
  plan:      string,
  stats:     WeeklyStats,
  weekLabel: string,
): string {
  const BG          = '#0A0B10';
  const CARD        = '#13151C';
  const ACCENT      = '#4F8EF7';
  const ACCENT_SOFT = '#6ba3f9';
  const TEXT        = '#FFFFFF';
  const TEXT_DIM    = 'rgba(255,255,255,0.55)';
  const TEXT_FAINT  = 'rgba(255,255,255,0.30)';
  const BORDER      = 'rgba(255,255,255,0.07)';

  const name   = escapeXml(userName);
  const week   = escapeXml(weekLabel);
  const plan_  = escapeXml(plan.charAt(0).toUpperCase() + plan.slice(1));
  const delta  = deltaArrow(stats.avgScoreThisWeek, stats.avgScoreLastWeek);
  const fluency = fluencyArrow(stats.fluencyTrend);
  const thisScore = fmtScore(stats.avgScoreThisWeek);
  const lastScore = fmtScore(stats.avgScoreLastWeek);
  const weakArea  = stats.topWeakArea ? escapeXml(stats.topWeakArea) : null;
  const trackLabel = stats.topExamTrack ? escapeXml(stats.topExamTrack) : null;

  // Name font-size scaling
  const NAME_MAX_WIDTH = 860;
  const NAME_BASE_SIZE = 48;
  const NAME_MIN_SIZE  = 26;
  const AVG_CHAR_RATIO = 0.62;
  const estimatedW     = userName.length * NAME_BASE_SIZE * AVG_CHAR_RATIO;
  const nameFontSize   = estimatedW > NAME_MAX_WIDTH
    ? Math.max(NAME_MIN_SIZE, Math.floor(NAME_BASE_SIZE * (NAME_MAX_WIDTH / estimatedW)))
    : NAME_BASE_SIZE;

  return `<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${BG}"/>
      <stop offset="100%" stop-color="#0d0f17"/>
    </linearGradient>
    <linearGradient id="acc" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="${ACCENT}"/>
      <stop offset="100%" stop-color="${ACCENT_SOFT}"/>
    </linearGradient>
  </defs>

  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect x="0" y="0" width="1200" height="6" fill="url(#acc)"/>

  <!-- card -->
  <rect x="48" y="48" width="1104" height="534" rx="24" fill="${CARD}" stroke="${BORDER}" stroke-width="1"/>

  <!-- wordmark -->
  <text x="88" y="118" font-size="26" font-weight="800" fill="${TEXT}" letter-spacing="-0.5">Vachix</text>

  <!-- plan badge -->
  <rect x="152" y="96" width="${24 + plan_.length * 8.5}" height="28" rx="14" fill="rgba(79,142,247,0.12)" stroke="rgba(79,142,247,0.3)" stroke-width="1"/>
  <text x="${152 + (24 + plan_.length * 8.5) / 2}" y="115" font-size="11" font-weight="700" fill="${ACCENT_SOFT}" letter-spacing="1.2" text-anchor="middle">${plan_}</text>

  <!-- week label -->
  <text x="1112" y="118" font-size="13" fill="${TEXT_FAINT}" text-anchor="end">${week}</text>

  <!-- name -->
  <text x="88" y="196" font-size="18" fill="${TEXT_DIM}" letter-spacing="0.5">Weekly summary for</text>
  <text x="88" y="${196 + nameFontSize + 8}" font-size="${nameFontSize}" font-weight="800" fill="${TEXT}" letter-spacing="-1">${name}</text>

  <!-- divider -->
  <line x1="88" y1="268" x2="1112" y2="268" stroke="${BORDER}" stroke-width="1"/>

  <!-- ROW 1: sessions | avg score | streak | xp -->
  <!-- stat: sessions -->
  <text x="88" y="306" font-size="11" fill="${TEXT_FAINT}" letter-spacing="0.8">SESSIONS</text>
  <text x="88" y="356" font-size="60" font-weight="800" fill="${ACCENT}" letter-spacing="-2">${stats.sessionsThisWeek}</text>

  <!-- stat: avg score -->
  <text x="310" y="306" font-size="11" fill="${TEXT_FAINT}" letter-spacing="0.8">AVG SCORE</text>
  <text x="310" y="350" font-size="54" font-weight="800" fill="${TEXT}" letter-spacing="-2">${thisScore}</text>
  <text x="${310 + 54 * thisScore.length * 0.56 + 6}" y="350" font-size="24" fill="${delta.color}" font-weight="700">${delta.symbol}</text>
  <text x="310" y="372" font-size="11" fill="${TEXT_FAINT}">vs ${lastScore} last week</text>

  <!-- stat: streak -->
  <text x="570" y="306" font-size="11" fill="${TEXT_FAINT}" letter-spacing="0.8">STREAK</text>
  <text x="570" y="350" font-size="54" font-weight="800" fill="${TEXT}" letter-spacing="-2">${stats.streak}</text>
  <text x="570" y="372" font-size="11" fill="${TEXT_FAINT}">day${stats.streak !== 1 ? 's' : ''}</text>

  <!-- stat: xp earned -->
  <text x="800" y="306" font-size="11" fill="${TEXT_FAINT}" letter-spacing="0.8">XP THIS WEEK</text>
  <text x="800" y="350" font-size="54" font-weight="800" fill="${ACCENT_SOFT}" letter-spacing="-2">${stats.xpEarnedThisWeek}</text>
  <text x="800" y="372" font-size="11" fill="${TEXT_FAINT}">points</text>

  <!-- divider 2 -->
  <line x1="88" y1="400" x2="1112" y2="400" stroke="${BORDER}" stroke-width="1"/>

  <!-- ROW 2: exam track | fluency | weak area -->
  ${trackLabel
    ? `<text x="88" y="430" font-size="11" fill="${TEXT_FAINT}" letter-spacing="0.8">EXAM TRACK</text>
  <text x="88" y="462" font-size="20" font-weight="700" fill="${TEXT}">${trackLabel}</text>`
    : `<text x="88" y="462" font-size="16" fill="${TEXT_FAINT}">No active prep path</text>`
  }

  <!-- fluency trend -->
  <text x="560" y="430" font-size="11" fill="${TEXT_FAINT}" letter-spacing="0.8">FLUENCY</text>
  <text x="560" y="462" font-size="22" font-weight="700" fill="${fluency.color}">${fluency.symbol} ${escapeXml(fluency.label)}</text>

  <!-- weak area -->
  ${weakArea
    ? `<text x="850" y="430" font-size="11" fill="${TEXT_FAINT}" letter-spacing="0.8">FOCUS AREA</text>
  <text x="850" y="462" font-size="20" font-weight="700" fill="${TEXT}">${weakArea}</text>`
    : ''
  }

  <!-- footer -->
  <line x1="88" y1="500" x2="1112" y2="500" stroke="${BORDER}" stroke-width="1"/>
  <text x="88" y="524" font-size="13" fill="${TEXT_FAINT}">vachix.in · Keep going 🚀</text>
</svg>`;
}

// ── Voiced summary (Pro+) ─────────────────────────────────────────────────

/**
 * Builds the Elara monologue script for a user's weekly summary.
 * Kept under 250 chars so it fits comfortably in Sarvam's 500-char limit.
 */
function buildVoicedSummaryText(userName: string, stats: WeeklyStats): string {
  const firstName = userName.split(' ')[0] || 'there';
  const sessions  = stats.sessionsThisWeek;
  const score     = stats.avgScoreThisWeek != null
    ? `Your average score was ${stats.avgScoreThisWeek.toFixed(0)} percent.`
    : '';
  const fluencyLine = stats.fluencyTrend === 'up'
    ? 'Your fluency improved this week — great work!'
    : stats.fluencyTrend === 'down'
    ? 'Your fluency dipped a little. Let\'s get it back up.'
    : '';

  return `Hi ${firstName}! Last week you completed ${sessions} session${sessions !== 1 ? 's' : ''}. ${score} Your current streak is ${stats.streak} day${stats.streak !== 1 ? 's' : ''}. ${fluencyLine} Keep it up — Vachix is proud of you!`.trim();
}

/**
 * Synthesises the voiced summary via Sarvam TTS and returns Base64 WAV.
 * Returns null on any failure — voiced summary is non-fatal.
 */
async function synthesiseVoicedSummary(text: string): Promise<string | null> {
  // SARVAM_API_KEY is the actual credential; SARVAM_PRIMARY is a boolean flag.
  if (!env.SARVAM_API_KEY) {
    log.debug('SARVAM_API_KEY not set — skipping voiced summary synthesis');
    return null;
  }

  try {
    const langCode = env.SARVAM_EN_LANG_CODE;
    const res = await fetch('https://api.sarvam.ai/text-to-speech', {
      method: 'POST',
      headers: {
        'Content-Type':          'application/json',
        'api-subscription-key':  env.SARVAM_API_KEY,
      },
      body: JSON.stringify({
        text:                 text.slice(0, 2500),  // Sarvam char limit
        target_language_code: langCode,
        model:                env.SARVAM_TTS_MODEL,
        speaker:              env.SARVAM_TTS_SPEAKER,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      log.warn('Sarvam TTS failed for voiced summary', { status: res.status, body: body.slice(0, 200) });
      return null;
    }

    const json = await res.json() as { audios?: string[] };
    const audioBase64 = json.audios?.[0];
    if (!audioBase64) {
      log.warn('Sarvam TTS returned no audio for voiced summary');
      return null;
    }

    return audioBase64;
  } catch (err) {
    log.warn('Sarvam TTS threw for voiced summary (non-fatal)', { error: String(err) });
    return null;
  }
}

// ── Push notification sender ───────────────────────────────────────────────

async function sendPushToUser(
  userId:  string,
  payload: { title: string; body: string; url: string },
): Promise<void> {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return;

  const subs = await db.getPushSubscriptions(userId);
  if (!subs.length) return;

  const json = JSON.stringify(payload);

  await Promise.allSettled(
    subs.map(async sub => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          json,
        );
      } catch (err: unknown) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 410 || status === 404) {
          await db.deletePushSubscription(sub.endpoint).catch(() => {});
          log.info('Removed expired push subscription', { userId, endpoint: sub.endpoint });
        } else {
          log.warn('Push send failed', { userId, endpoint: sub.endpoint, status, error: String(err) });
        }
      }
    })
  );
}

// ── Main entry point (called by BullMQ worker) ────────────────────────────

/**
 * Generates and stores a weekly card for all users who have completed
 * at least one session. Sends push notifications to subscribed users.
 * Pro+ users also get a voiced Elara summary stored as Base64 WAV.
 *
 * Designed to be idempotent — re-running overwrites weekly_card_url with
 * a freshly generated SVG and weekly_card_voiced_url with a fresh WAV.
 */
export async function generateWeeklyProgressCards(): Promise<void> {
  log.info('Weekly progress card generation started');

  const now      = new Date();
  const weekEnd  = now.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
  const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
  const weekLabel = `${weekStart} – ${weekEnd}`;

  const PAGE  = 50;
  let offset  = 0;
  let total   = Infinity;
  let generated = 0;
  let pushed    = 0;
  let voiced    = 0;

  while (offset < total) {
    const { users, total: t } = await db.getUsersPage(PAGE, offset);
    total  = t;
    offset += PAGE;

    await Promise.allSettled(
      users.map(async user => {
        try {
          const stats = await getWeeklyStats(user.id);

          // Skip users with zero activity ever
          if (stats.sessionsThisWeek === 0 && stats.streak === 0 && !stats.avgScoreThisWeek) {
            return;
          }

          const effectivePlan = db.getEffectivePlan(user);

          const svg = renderWeeklyCardSvg(
            user.name || 'Vachix User',
            effectivePlan,
            stats,
            weekLabel,
          );

          // Derive updates object — always write SVG; write voiced only for Pro+
          const updates: Record<string, string | null> = { weekly_card_url: svg };

          // Pro and Elite users get a voiced summary
          const isPro = effectivePlan === 'pro' || effectivePlan === 'elite';
          if (isPro) {
            const summaryText    = buildVoicedSummaryText(user.name || 'Vachix User', stats);
            const voicedBase64   = await synthesiseVoicedSummary(summaryText);
            updates.weekly_card_voiced_url = voicedBase64;
            if (voicedBase64) voiced++;
          } else {
            // Clear any stale voiced URL if the user downgraded
            updates.weekly_card_voiced_url = null;
          }

          await db.updateUser(user.id, updates as never);
          generated++;

          // Push notification
          const hasSessions = stats.sessionsThisWeek > 0;
          const body = hasSessions
            ? `You did ${stats.sessionsThisWeek} session${stats.sessionsThisWeek !== 1 ? 's' : ''} this week. Avg score: ${fmtScore(stats.avgScoreThisWeek)}/10`
            : `Your streak is ${stats.streak} day${stats.streak !== 1 ? 's' : ''}. Keep it going!`;

          await sendPushToUser(user.id, {
            title: '📊 Your weekly Vachix summary is ready',
            body,
            url:   `${env.FRONTEND_URL}/progress`,
          });
          pushed++;
        } catch (err) {
          log.error('Weekly card generation failed for user', { userId: user.id, error: String(err) });
        }
      })
    );
  }

  log.info('Weekly progress card generation complete', { generated, pushed, voiced });
}
