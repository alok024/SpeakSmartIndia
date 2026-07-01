// Mounted in app.ts under both /api/push/* and /api/weekly-card.
import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware, validate } from '../../core/middleware';
import {
  getVapidPublicKey,
  subscribePush,
  unsubscribePush,
  registerDevice,
  unregisterDevice,
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

const DeviceTokenSchema = z.object({
  token:    z.string().min(1),
  platform: z.enum(['ios', 'android']),
});

const UnregisterDeviceSchema = z.object({
  token: z.string().min(1),
});

// Public — frontend reads this before calling PushManager.subscribe()
pushRouter.get('/push/vapid-public-key', getVapidPublicKey);

// Auth-required — manage Web Push subscriptions (browser)
pushRouter.post('/push/subscribe',    authMiddleware, validate(SubscribeSchema),    subscribePush);
pushRouter.delete('/push/unsubscribe', authMiddleware, validate(UnsubscribeSchema), unsubscribePush);

// Auth-required — manage FCM device tokens (mobile). Storage only for now;
// see the TODO in push.service.ts for what's still needed to actually send.
pushRouter.post('/push/register-device',    authMiddleware, validate(DeviceTokenSchema),       registerDevice);
pushRouter.delete('/push/unregister-device', authMiddleware, validate(UnregisterDeviceSchema), unregisterDevice);

// Public weekly card SVG
pushRouter.get('/weekly-card/:userId', getWeeklyCardSvg);

// Auth-required — voiced weekly summary (Pro+ only; content is user-specific)
pushRouter.get('/weekly-card/:userId/voice', authMiddleware, getWeeklyCardVoice);
