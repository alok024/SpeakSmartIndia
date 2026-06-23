/**
 * Push Notification Routes
 *
 * Mounted in app.ts:
 *   /api/push/*       — subscription management (subscribe / unsubscribe / vapid key)
 *   /api/weekly-card  — weekly progress card SVG (public)
 */

import { Router } from 'express';
import { authMiddleware } from '../../core/middleware';
import {
  getVapidPublicKey,
  subscribePush,
  unsubscribePush,
  getWeeklyCardSvg,
} from './push.controller';

export const pushRouter = Router();

// Public — frontend reads this before calling PushManager.subscribe()
pushRouter.get('/push/vapid-public-key', getVapidPublicKey);

// Auth-required — manage subscriptions
pushRouter.post('/push/subscribe',    authMiddleware, subscribePush);
pushRouter.delete('/push/unsubscribe', authMiddleware, unsubscribePush);

// Public weekly card SVG
pushRouter.get('/weekly-card/:userId', getWeeklyCardSvg);
