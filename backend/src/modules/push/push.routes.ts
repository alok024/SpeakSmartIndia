// Mounted in app.ts under both /api/push/* and /api/weekly-card.
import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware, validate } from '../../core/middleware';
import {
  getVapidPublicKey,
  subscribePush,
  unsubscribePush,
  getWeeklyCardSvg,
  getWeeklyCardVoice,
} from './push.controller';

export const pushRouter = Router();

const SubscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth:   z.string().min(1),
  }),
});

const UnsubscribeSchema = z.object({
  endpoint: z.string().url(),
});

// Public — frontend reads this before calling PushManager.subscribe()
pushRouter.get('/push/vapid-public-key', getVapidPublicKey);

// Auth-required — manage subscriptions
pushRouter.post('/push/subscribe',    authMiddleware, validate(SubscribeSchema),    subscribePush);
pushRouter.delete('/push/unsubscribe', authMiddleware, validate(UnsubscribeSchema), unsubscribePush);

// Public weekly card SVG
pushRouter.get('/weekly-card/:userId', getWeeklyCardSvg);

// Auth-required — voiced weekly summary (Pro+ only; content is user-specific)
pushRouter.get('/weekly-card/:userId/voice', authMiddleware, getWeeklyCardVoice);
