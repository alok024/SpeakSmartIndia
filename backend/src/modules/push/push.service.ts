import { initializeApp, getApps, cert }      from 'firebase-admin/app';
import { getMessaging }                       from 'firebase-admin/messaging';
import type { MulticastMessage, BatchResponse } from 'firebase-admin/messaging';
import type { ServiceAccount }                from 'firebase-admin/app';
import { db }     from '../../core/database/client';
import { env }    from '../../core/config/env';
import { logger } from '../../infra/logger';

const log = logger.child({ module: 'push' });

// ── FCM init ─────────────────────────────────────────────────────────────────
//
// Initialised lazily on first send.  A missing / invalid
// FIREBASE_SERVICE_ACCOUNT_JSON never prevents the process from starting.

let fcmState: 'uninitialised' | 'ready' | 'disabled' = 'uninitialised';

function ensureFcmInit(): boolean {
  if (fcmState === 'ready')    return true;
  if (fcmState === 'disabled') return false;

  if (!env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    fcmState = 'disabled';
    return false;
  }

  let credential: ServiceAccount;
  try {
    credential = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON) as ServiceAccount;
  } catch {
    log.error('FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON — FCM disabled');
    fcmState = 'disabled';
    return false;
  }

  if (!getApps().length) {
    initializeApp({ credential: cert(credential) });
  }

  fcmState = 'ready';
  log.info('Firebase Admin SDK initialised');
  return true;
}

// ── Web Push subscription types ───────────────────────────────────────────────

export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export function getVapidPublicKey(): string | null {
  return env.VAPID_PUBLIC_KEY ?? null;
}

export async function subscribe(userId: string, input: PushSubscriptionInput): Promise<void> {
  await db.upsertPushSubscription({
    user_id:  userId,
    endpoint: input.endpoint,
    p256dh:   input.keys.p256dh,
    auth:     input.keys.auth,
  });
  log.info('Push subscription saved', { userId, endpoint: input.endpoint.slice(0, 60) });
}

export async function unsubscribe(userId: string, endpoint: string): Promise<void> {
  await db.deletePushSubscriptionForUser(endpoint, userId);
  log.info('Push subscription removed', { userId });
}

// ── Device tokens / FCM ───────────────────────────────────────────────────────

export interface DeviceTokenInput {
  token:    string;
  platform: 'ios' | 'android';
}

export async function registerDevice(userId: string, input: DeviceTokenInput): Promise<void> {
  await db.upsertDeviceToken({ user_id: userId, token: input.token, platform: input.platform });
  log.info('Device token registered', { userId, platform: input.platform });
}

export async function unregisterDevice(userId: string, token: string): Promise<void> {
  await db.deleteDeviceToken(token, userId);
  log.info('Device token removed', { userId });
}

// ── FCM send helper ───────────────────────────────────────────────────────────

export interface FcmPayload {
  title: string;
  body:  string;
  url?:  string;
}

/**
 * Sends an FCM notification to every registered device for a user.
 *
 * Stale tokens (FCM error codes registration-token-not-registered /
 * invalid-registration-token) are removed from the database so they don't
 * accumulate.  All other per-token failures are logged and swallowed — a
 * failed push notification is never worth aborting the caller's main work.
 *
 * Returns silently (no-op) if:
 *   - FIREBASE_SERVICE_ACCOUNT_JSON is not set, or
 *   - the user has no registered device tokens.
 */
export async function sendFcmToUser(userId: string, payload: FcmPayload): Promise<void> {
  if (!ensureFcmInit()) return;

  const tokens = await db.getDeviceTokensForUser(userId);
  if (!tokens.length) return;

  const message: MulticastMessage = {
    tokens: tokens.map(t => t.token),
    notification: {
      title: payload.title,
      body:  payload.body,
    },
    ...(payload.url
      ? {
          webpush: { fcmOptions: { link: payload.url } },
          android: { notification: { clickAction: payload.url } },
          apns:    { payload: { aps: { category: 'OPEN_URL' } } },
        }
      : {}),
  };

  let response: BatchResponse;
  try {
    response = await getMessaging().sendEachForMulticast(message);
  } catch (err) {
    log.warn('FCM multicast call failed (non-fatal)', { userId, error: String(err) });
    return;
  }

  if (response.failureCount === 0) return;

  await Promise.allSettled(
    response.responses.map(async (r, i) => {
      if (r.success) return;
      const code = r.error?.code ?? '';
      if (
        code === 'messaging/registration-token-not-registered' ||
        code === 'messaging/invalid-registration-token'
      ) {
        await db.deleteDeviceTokenAnyUser(tokens[i].token).catch(() => {});
        log.info('Removed stale FCM token', { userId, code });
      } else {
        log.warn('FCM send failed for token', { userId, code, error: r.error?.message });
      }
    })
  );
}

// ── Weekly card helpers ───────────────────────────────────────────────────────

/** Weekly card SVG is stored inline on the user row. */
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
