/**
 * Reports Service — Shareable session reports
 *
 * /report/:shareToken  → public read-only page (no auth required).
 *
 * H3: the share token is an HMAC-SHA256-signed reference to the session
 * UUID, not a bare reversible encoding. Format: `<base64url id>.<base64url mac>`
 * where mac = HMAC-SHA256(REPORT_SECRET, id), truncated to 16 bytes
 * (128 bits — far beyond brute-force range) and compared in constant time.
 * This prevents anyone from forging a working share link for a session
 * they don't already hold a token for, even if they know or guess the
 * session's UUID (e.g. from logs, sequential IDs, or another leak).
 */

import crypto from 'crypto';
import { env } from '../../core/config/env';
import { db } from '../../core/database/client';
import { getWeakAreasForUser, WeakAreaEntry } from '../analytics/reports/weak-areas.service';
import { getOrCreateReferralCode } from '../growth/referral.service';
import { getRedis } from '../../infra/queue/redis';
import { logger } from '../../infra/logger';

const log = logger.child({ module: 'reports' });

// /api/report/:shareToken is public + unauthenticated. The global rate
// limiter (app.ts) already covers it, but each request still does up to
// 4 DB round-trips (session, feedback, user, weak areas). Cache the
// assembled report for a short TTL so repeated hits on a popular shared
// link don't amplify into repeated DB reads.
const REPORT_CACHE_PREFIX = 'report:cache';
const REPORT_CACHE_TTL_S  = 300; // 5 min

// Token encode/decode (H3: HMAC-signed)

const MAC_BYTES = 16; // 128-bit truncated HMAC — ample collision resistance

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlToBuffer(input: string): Buffer {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad    = (4 - (padded.length % 4)) % 4;
  return Buffer.from(padded + '='.repeat(pad), 'base64');
}

function signSessionId(sessionId: string): Buffer {
  return crypto
    .createHmac('sha256', env.REPORT_SECRET)
    .update(sessionId, 'utf8')
    .digest()
    .subarray(0, MAC_BYTES);
}

export function encodeShareToken(sessionId: string): string {
  const idPart  = b64url(Buffer.from(sessionId, 'utf8'));
  const macPart = b64url(signSessionId(sessionId));
  return `${idPart}.${macPart}`;
}

export function decodeShareToken(token: string): string | null {
  try {
    const dotIndex = token.lastIndexOf('.');
    if (dotIndex < 0) return null; // old unsigned-format tokens are rejected by design

    const idPart  = token.slice(0, dotIndex);
    const macPart = token.slice(dotIndex + 1);
    if (!idPart || !macPart) return null;

    const sessionId = b64urlToBuffer(idPart).toString('utf8');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId)) {
      return null;
    }

    const expectedMac = signSessionId(sessionId);
    const givenMac     = b64urlToBuffer(macPart);
    if (givenMac.length !== expectedMac.length) return null;
    if (!crypto.timingSafeEqual(givenMac, expectedMac)) return null;

    return sessionId;
  } catch {
    return null;
  }
}

// Public report shape

export interface PublicReport {
  share_token: string;
  share_url:   string;
  referral_code?: string; // the report owner's referral code, appended to share_url
  user: { name: string };
  session: {
    id:              string;
    profession:      string;
    mode:            string;
    difficulty:      string;
    interview_type:  string;
    score:           number;
    exchanges:       number;
    duration_secs:   number;
    job_ready_score: number;
    clarity_score:   number;
    structure_score: number;
    relevance_score: number;
    grammar_score:   number;
    created_at:      string;
  };
  feedback: Array<{
    question:     string;
    answer:       string;
    score:        number;
    tips:         string;
    corrections:  unknown[];
    structure:    Record<string, unknown>;
    model_answer: Record<string, unknown>;
  }>;
  weak_areas: WeakAreaEntry[];
}

function safeJson<T>(val: unknown, fallback: T): T {
  try {
    return typeof val === 'string' ? (JSON.parse(val) as T) : ((val as T) ?? fallback);
  } catch {
    return fallback;
  }
}

// Fetch session without user_id restriction (public access)

async function fetchSessionById(sessionId: string) {
  const url = `${env.SUPABASE_URL}/rest/v1/sessions?id=eq.${sessionId}&select=*`;
  const res = await fetch(url, {
    headers: {
      'apikey':        env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    },
  });
  if (!res.ok) return null;
  const rows = await res.json() as Array<{
    id?: string; user_id: string; profession: string; mode: string;
    difficulty: string; interview_type: string; score: number;
    exchanges: number; duration_secs: number; created_at?: string;
    job_ready_score?: number; clarity_score?: number;
    structure_score?: number; relevance_score?: number; grammar_score?: number;
  }>;
  return rows[0] ?? null;
}

// Main export

export async function getPublicReport(shareToken: string): Promise<PublicReport | null> {
  const sessionId = decodeShareToken(shareToken);
  if (!sessionId) return null;

  // serve from cache when available — public, unauthenticated endpoint
  // with no per-viewer variation, so a short shared TTL is safe.
  const redis = getRedis();
  const cacheKey = `${REPORT_CACHE_PREFIX}:${shareToken}`;

  if (redis) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) return JSON.parse(cached) as PublicReport;
    } catch (err) {
      log.warn('Report cache GET failed — proceeding without cache', { error: (err as Error).message });
    }
  }

  const report = await _fetchPublicReport(sessionId, shareToken);
  if (!report) return null;

  if (redis) {
    try {
      await redis.set(cacheKey, JSON.stringify(report), 'EX', REPORT_CACHE_TTL_S);
    } catch (err) {
      log.warn('Report cache SET failed — continuing', { error: (err as Error).message });
    }
  }

  return report;
}

async function _fetchPublicReport(sessionId: string, shareToken: string): Promise<PublicReport | null> {
  const [session, feedbackRows] = await Promise.all([
    fetchSessionById(sessionId),
    db.getSessionFeedback(sessionId),
  ]);

  if (!session) return null;

  const [user, weakAreas] = await Promise.all([
    db.getUserById(session.user_id),
    getWeakAreasForUser(session.user_id),
  ]);

  // Attach the report owner's referral code to the share URL so that
  // anyone who clicks through from a shared brag card / report and
  // signs up gets attributed to them — closing the referral loop.
  let referralCode: string | undefined;
  try {
    const referral = await getOrCreateReferralCode(session.user_id);
    referralCode = referral.code;
  } catch {
    // Non-fatal — report still renders without referral attribution
  }

  const shareUrl = referralCode
    ? `${env.FRONTEND_URL}/report?id=${shareToken}&ref=${referralCode}`
    : `${env.FRONTEND_URL}/report?id=${shareToken}`;

  return {
    share_token: shareToken,
    share_url:   shareUrl,
    referral_code: referralCode,
    user: { name: user?.name || 'Vachix User' },
    session: {
      id:              session.id!,
      profession:      session.profession,
      mode:            session.mode,
      difficulty:      session.difficulty,
      interview_type:  session.interview_type,
      score:           session.score,
      exchanges:       session.exchanges,
      duration_secs:   session.duration_secs,
      job_ready_score: session.job_ready_score ?? 0,
      clarity_score:   session.clarity_score   ?? 0,
      structure_score: session.structure_score ?? 0,
      relevance_score: session.relevance_score ?? 0,
      grammar_score:   session.grammar_score   ?? 0,
      created_at:      session.created_at!,
    },
    feedback: feedbackRows.map(f => ({
      question:     f.question,
      answer:       f.answer,
      score:        f.score,
      tips:         f.tips,
      corrections:  safeJson<unknown[]>(f.corrections, []),
      structure:    safeJson<Record<string, unknown>>(f.structure, {}),
      model_answer: safeJson<Record<string, unknown>>(f.model_answer, {}),
    })),
    weak_areas: weakAreas.slice(0, 3),
  };
}
