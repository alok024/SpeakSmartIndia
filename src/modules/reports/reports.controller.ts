import { Request, Response } from 'express';
import { asyncHandler } from '../../core/middleware';
import { getPublicReport, encodeShareToken } from './reports.service';
import { db } from '../../core/database/client';

// GET /api/sessions/:id/share-token  (auth required — only session owner)
export const getShareToken = asyncHandler(async (req: Request, res: Response) => {
  const userId    = req.user!.id;
  const sessionId = req.params.id;

  const session = await db.getSessionById(sessionId, userId);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  const shareToken = encodeShareToken(session.id!);
  const shareUrl   = `${process.env.FRONTEND_URL || 'https://speaksmart.in'}/report.html?id=${shareToken}`;

  res.json({ share_token: shareToken, share_url: shareUrl });
});

// GET /api/report/:shareToken  (public — no auth)
export const getReport = asyncHandler(async (req: Request, res: Response) => {
  const report = await getPublicReport(req.params.shareToken);

  if (!report) {
    res.status(404).json({ error: 'Report not found or invalid link' });
    return;
  }

  res.json(report);
});
