import { Request, Response } from 'express';
import { asyncHandler } from '../../core/middleware';
import { getPublicReport, encodeShareToken } from './reports.service';
import { getOrCreateReferralCode } from '../growth/referral.service';
import { trackEvent } from '../analytics/events.service';
import { db } from '../../core/database/client';
import { ok, notFound } from '../../core/utils/response';
import { env }          from '../../core/config/env';

// GET /api/sessions/:id/share-token  (auth required — only session owner)
export const getShareToken = asyncHandler(async (req: Request, res: Response) => {
  const userId    = req.user!.id;
  const sessionId = req.params.id;

  const session = await db.getSessionById(sessionId, userId);
  if (!session) {
    notFound(res, 'Session not found');
    return;
  }

  const shareToken = encodeShareToken(String(session.id!));

  // Append the user's referral code so shares from the app
  // also carry attribution, same as the public report page.
  let referralCode: string | undefined;
  try {
    const referral = await getOrCreateReferralCode(userId);
    referralCode = referral.code;
  } catch {
    // Non-fatal — share link still works without referral attribution
  }

  const base     = env.FRONTEND_URL;
  const shareUrl = referralCode
    ? `${base}/report?id=${shareToken}&ref=${referralCode}`
    : `${base}/report?id=${shareToken}`;

  // Record that this user initiated a share action — lets us track
  // share → click → signup funnel even before the referred user signs up.
  trackEvent({
    event:     'share_initiated',
    userId:    userId,
    sessionId: sessionId,
    path:      '/api/sessions/:id/share-token',
    properties: {
      ref_code:  referralCode ?? null,
      share_url: shareUrl,
    },
  });

  ok(res, { share_token: shareToken, share_url: shareUrl, referral_code: referralCode });
});

// GET /api/report/:shareToken  (public — no auth)
export const getReport = asyncHandler(async (req: Request, res: Response) => {
  const report = await getPublicReport(req.params.shareToken);

  if (!report) {
    notFound(res, 'Report not found or invalid link');
    return;
  }

  // Attribution: track that someone opened a shared report link.
  // ref_code comes from the URL the sharer distributed; it's embedded
  // into share_url by getShareToken / getPublicReport server-side.
  const inboundRef = req.query.ref as string | undefined;
  trackEvent({
    event:     'share_opened',
    userId:    null,
    sessionId: report.session.id,
    path:      '/api/report/:shareToken',
    properties: {
      ref_code:       report.referral_code ?? null,
      inbound_ref:    inboundRef ?? null,
      viewer_ip:      req.ip ?? null,
    },
  });

  ok(res, report);
});
