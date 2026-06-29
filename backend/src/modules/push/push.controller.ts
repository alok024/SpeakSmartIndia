import { Request, Response } from 'express';
import { asyncHandler } from '../../core/middleware';
import { ok, badRequest, notFound } from '../../core/utils/response';
import { logger } from '../../infra/logger';
import * as PushService from './push.service';

const log = logger.child({ module: 'push' });

export const getVapidPublicKey = asyncHandler(async (_req: Request, res: Response) => {
  const key = PushService.getVapidPublicKey();
  if (!key) {
    badRequest(res, 'Push notifications not configured', 'vapid_not_configured');
    return;
  }
  ok(res, { publicKey: key });
});

export const subscribePush = asyncHandler(async (req: Request, res: Response) => {
  await PushService.subscribe(req.user!.id, req.body);
  ok(res, { subscribed: true });
});

export const unsubscribePush = asyncHandler(async (req: Request, res: Response) => {
  await PushService.unsubscribe(req.user!.id, req.body.endpoint);
  ok(res, { unsubscribed: true });
});

// Public — SVG is designed to be shareable without auth.
export const getWeeklyCardSvg = asyncHandler(async (req: Request, res: Response) => {
  const svg = await PushService.getWeeklyCardSvg(req.params.userId);
  if (svg === null) {
    notFound(res, 'Weekly card not found');
    return;
  }
  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.send(svg);
});

// Auth required — unlike the SVG, the voiced card isn't designed for public sharing.
export const getWeeklyCardVoice = asyncHandler(async (req: Request, res: Response) => {
  if (req.user!.id !== req.params.userId) {
    notFound(res, 'Not found');
    return;
  }

  const wav = await PushService.getWeeklyCardVoiceBuffer(req.params.userId);
  if (!wav) {
    notFound(res, 'Voiced weekly card not available');
    return;
  }

  res.setHeader('Content-Type', 'audio/wav');
  res.setHeader('Content-Length', String(wav.byteLength));
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.end(wav);
  log.debug('Served voiced weekly card', { userId: req.params.userId });
});
