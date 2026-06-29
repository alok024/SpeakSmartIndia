import { db } from '../../core/database/client';
import { env } from '../../core/config/env';
import { logger } from '../../infra/logger';

const log = logger.child({ module: 'push' });

export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export function getVapidPublicKey(): string | null {
  return env.VAPID_PUBLIC_KEY ?? null;
}

export async function subscribe(userId: string, input: PushSubscriptionInput): Promise<void> {
  await db.upsertPushSubscription({
    user_id: userId,
    endpoint: input.endpoint,
    p256dh: input.keys.p256dh,
    auth: input.keys.auth,
  });
  log.info('Push subscription saved', { userId, endpoint: input.endpoint.slice(0, 60) });
}

export async function unsubscribe(userId: string, endpoint: string): Promise<void> {
  await db.deletePushSubscriptionForUser(endpoint, userId);
  log.info('Push subscription removed', { userId });
}

/** Weekly card SVG is stored inline on the user row (column name predates this). */
export async function getWeeklyCardSvg(userId: string): Promise<string | null> {
  const user = await db.getUserById(userId);
  return user?.weekly_card_url ?? null;
}

/** Voiced summary is Pro+ only; returns null when not generated or plan-gated. */
export async function getWeeklyCardVoiceBuffer(userId: string): Promise<Buffer | null> {
  const user = await db.getUserById(userId);
  if (!user?.weekly_card_voiced_url) return null;
  return Buffer.from(user.weekly_card_voiced_url, 'base64');
}
